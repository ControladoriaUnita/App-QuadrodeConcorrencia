-- =============================================================================
-- 016_addendum_kind_allocations.sql
-- Aditivos e distratos item a item, com vínculo de planejamento (IP) por item.
--
--   * contract_addenda.kind: 'addendum' (aditivo, soma) ou 'termination' (distrato, subtrai).
--     Numeração própria por tipo: 1º aditivo, 1º distrato...
--   * O sinal da quantidade segue o tipo: aditivo > 0, distrato < 0 (conferido por gatilho).
--   * contract_addendum_item_allocations: quanto de cada item vai para cada IP, para o
--     planejamento vincular no ERP. Mesmo sinal do item; a soma fecha com a quantidade
--     do item (conferida pela aplicação no envio para aprovação).
-- =============================================================================

create type public.addendum_kind as enum ('addendum', 'termination');

alter table public.contract_addenda
  add column if not exists kind public.addendum_kind not null default 'addendum';

alter table public.contract_addenda drop constraint if exists contract_addenda_contract_request_id_number_key;
alter table public.contract_addenda
  add constraint contract_addenda_number_by_kind unique (contract_request_id, kind, number);

-- O tipo não muda depois de criado (as quantidades dependem dele)
create or replace function public.guard_addendum_kind()
returns trigger language plpgsql
as $$
begin
  if new.kind <> old.kind then
    raise exception 'ADDENDUM_KIND_LOCKED: o tipo do lançamento não pode ser alterado' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger contract_addenda_kind_guard before update on public.contract_addenda
  for each row execute function public.guard_addendum_kind();

-- Sinal da quantidade conforme o tipo; distrato só reduz itens do contrato
create or replace function public.check_addendum_item_sign()
returns trigger language plpgsql
as $$
declare v_kind public.addendum_kind;
begin
  select kind into v_kind from public.contract_addenda where id = new.addendum_id;
  if v_kind = 'addendum' and new.quantity_delta <= 0 then
    raise exception 'ADDENDUM_SIGN: no aditivo a quantidade do item % deve ser positiva', new.code using errcode = 'P0001';
  end if;
  if v_kind = 'termination' and (new.quantity_delta >= 0 or new.contract_request_item_id is null) then
    raise exception 'ADDENDUM_SIGN: no distrato o item % deve ser do contrato e ter quantidade negativa', new.code using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger contract_addendum_items_sign before insert or update on public.contract_addendum_items
  for each row execute function public.check_addendum_item_sign();

-- -----------------------------------------------------------------------------
-- Vínculos de planejamento por item do aditivo/distrato
-- -----------------------------------------------------------------------------
create table public.contract_addendum_item_allocations (
  id                 uuid primary key default gen_random_uuid(),
  addendum_item_id   uuid not null references public.contract_addendum_items (id) on delete cascade,
  package_code       text not null,                 -- IP vinculado
  location_code      text,
  quantity           public.qty4 not null check (quantity <> 0),
  created_at         timestamptz not null default now()
);
create index contract_addendum_item_allocations_item_idx on public.contract_addendum_item_allocations (addendum_item_id);

create or replace function public.addendum_item_work_id(p_item_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select public.addendum_work_id(addendum_id) from public.contract_addendum_items where id = p_item_id
$$;

-- Mesma trava dos itens: só muda enquanto o aditivo está em rascunho
create or replace function public.guard_addendum_allocation()
returns trigger language plpgsql
as $$
declare v_status public.addendum_status;
begin
  select a.status into v_status
    from public.contract_addendum_items i join public.contract_addenda a on a.id = i.addendum_id
   where i.id = case when tg_op = 'DELETE' then old.addendum_item_id else new.addendum_item_id end;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'ADDENDUM_LOCKED: vínculos do aditivo não podem ser alterados fora do rascunho' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger contract_addendum_item_allocations_guard before insert or update or delete on public.contract_addendum_item_allocations
  for each row execute function public.guard_addendum_allocation();

create trigger contract_addendum_item_allocations_audit after insert or update or delete on public.contract_addendum_item_allocations
  for each row execute function public.audit_row_changes();

alter table public.contract_addendum_item_allocations enable row level security;

create policy contract_addendum_item_allocations_select on public.contract_addendum_item_allocations for select to authenticated
  using (public.auth_has_permission('contract.read', public.addendum_item_work_id(addendum_item_id)));
create policy contract_addendum_item_allocations_write on public.contract_addendum_item_allocations for all to authenticated
  using (public.auth_has_permission('contract.manage', public.addendum_item_work_id(addendum_item_id)))
  with check (public.auth_has_permission('contract.manage', public.addendum_item_work_id(addendum_item_id)));

grant select, insert, update, delete on public.contract_addendum_item_allocations to authenticated;
