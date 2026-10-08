-- =============================================================================
-- 013_contract_requests.sql
-- Solicitação de Contrato e Aditivos (abas "Solic. Contrato" e "Solic. Aditivo")
--   - seções do formulário: projetos, escopo técnico, materiais com faturamento
--     direto, critérios de medição
--   - ciclo de vida (enviada, enviada ao ERP, assinada, cancelada) e decisão do aditivo
--   - travas: solicitação fora de rascunho e aditivo fora de rascunho não mudam
--   - uma solicitação ativa por concorrência
-- =============================================================================

alter table public.contract_requests
  add column if not exists budget_amount            public.money4 not null default 0,   -- verba do QC (revisão aprovada)
  add column if not exists available_amount         public.money4 not null default 0,   -- verba disponível do QC
  add column if not exists projects                 jsonb not null default '[]'::jsonb, -- [{sheet, fileName, revision}]
  add column if not exists scope_definitions        text,
  add column if not exists direct_billing_materials text,
  add column if not exists measurement_criteria     text,
  add column if not exists submitted_at             timestamptz,
  add column if not exists submitted_by             uuid references auth.users (id),
  add column if not exists sent_to_erp_at           timestamptz,
  add column if not exists signed_on                date,
  add column if not exists cancel_reason            text,
  add constraint contract_projects_is_array check (jsonb_typeof(projects) = 'array'),
  add constraint contract_distribution_ok check (pct_material + pct_equipment + pct_service between 0.999999 and 1.000001 or total_amount = 0);

alter table public.contract_request_items
  add column if not exists pct_material  public.ratio6 not null default 0,
  add column if not exists pct_equipment public.ratio6 not null default 0,
  add column if not exists sort_order    integer not null default 0;

-- O aditivo passa a ser decidido (Gerente / Diretoria); 'sent_to_erp' do enum fica reservado.
alter table public.contract_addenda
  add column if not exists submitted_at      timestamptz,
  add column if not exists submitted_by      uuid references auth.users (id),
  add column if not exists decided_at        timestamptz,
  add column if not exists decided_by        uuid references auth.users (id),
  add column if not exists decision_comment  text,
  add constraint addendum_reject_needs_comment check (status <> 'rejected' or coalesce(trim(decision_comment), '') <> '');

alter table public.contract_addendum_items
  add column if not exists sort_order integer not null default 0;

-- Uma solicitação não cancelada por concorrência
create unique index if not exists contract_requests_one_active
  on public.contract_requests (competition_id) where status <> 'cancelled';
create index if not exists contract_request_items_request_idx on public.contract_request_items (contract_request_id);
create index if not exists contract_addenda_request_idx on public.contract_addenda (contract_request_id);

-- -----------------------------------------------------------------------------
-- Travas
-- -----------------------------------------------------------------------------
-- Solicitação fora de rascunho: só avançam status, nº no ERP, envio/assinatura e cancelamento.
create or replace function public.guard_contract_request()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'CONTRACT_LOCKED: solicitação % não está em rascunho', old.code using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and
     (to_jsonb(new) - 'status' - 'erp_contract_id' - 'submitted_at' - 'submitted_by' - 'sent_to_erp_at'
                    - 'signed_on' - 'cancel_reason' - 'updated_at' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'status' - 'erp_contract_id' - 'submitted_at' - 'submitted_by' - 'sent_to_erp_at'
                    - 'signed_on' - 'cancel_reason' - 'updated_at' - 'updated_by') then
    raise exception 'CONTRACT_LOCKED: solicitação % não está em rascunho', old.code using errcode = 'P0001';
  end if;
  if old.status in ('cancelled', 'signed') and new.status is distinct from old.status then
    raise exception 'CONTRACT_LOCKED: solicitação % encerrada', old.code using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger contract_requests_guard before update or delete on public.contract_requests
  for each row execute function public.guard_contract_request();

create or replace function public.guard_contract_request_child()
returns trigger language plpgsql
as $$
declare
  v_request uuid;
  v_status  public.contract_request_status;
begin
  if tg_table_name = 'contract_item_allocations' then
    select i.contract_request_id into v_request from public.contract_request_items i
     where i.id = coalesce(new.contract_request_item_id, old.contract_request_item_id);
  elsif tg_op = 'DELETE' then
    v_request := old.contract_request_id;
  else
    v_request := new.contract_request_id;
  end if;
  select status into v_status from public.contract_requests where id = v_request;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'CONTRACT_LOCKED: itens da solicitação não podem ser alterados fora do rascunho' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger contract_request_items_guard before insert or update or delete on public.contract_request_items
  for each row execute function public.guard_contract_request_child();
create trigger contract_item_allocations_guard before insert or update or delete on public.contract_item_allocations
  for each row execute function public.guard_contract_request_child();

-- Aditivo fora de rascunho: só a decisão (submitted → approved/rejected) é aceita.
create or replace function public.guard_contract_addendum()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'ADDENDUM_LOCKED: aditivo % não está em rascunho', old.number using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status = 'draft' then return new; end if;
  if old.status = 'submitted' and new.status in ('approved', 'rejected') and
     (to_jsonb(new) - 'status' - 'decided_at' - 'decided_by' - 'decision_comment' - 'updated_at' - 'updated_by')
     = (to_jsonb(old) - 'status' - 'decided_at' - 'decided_by' - 'decision_comment' - 'updated_at' - 'updated_by') then
    return new;
  end if;
  raise exception 'ADDENDUM_LOCKED: aditivo % não está em rascunho', old.number using errcode = 'P0001';
end;
$$;

create trigger contract_addenda_guard before update or delete on public.contract_addenda
  for each row execute function public.guard_contract_addendum();

create or replace function public.guard_contract_addendum_item()
returns trigger language plpgsql
as $$
declare v_status public.addendum_status;
begin
  select status into v_status from public.contract_addenda
   where id = case when tg_op = 'DELETE' then old.addendum_id else new.addendum_id end;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'ADDENDUM_LOCKED: itens do aditivo não podem ser alterados fora do rascunho' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger contract_addendum_items_guard before insert or update or delete on public.contract_addendum_items
  for each row execute function public.guard_contract_addendum_item();

-- Aditivo só em contrato que saiu do rascunho e não foi cancelado
create or replace function public.guard_addendum_parent()
returns trigger language plpgsql
as $$
declare v_status public.contract_request_status;
begin
  select status into v_status from public.contract_requests where id = new.contract_request_id;
  if v_status not in ('submitted', 'sent_to_erp', 'signed') then
    raise exception 'ADDENDUM_NOT_ALLOWED: a solicitação de contrato precisa estar enviada' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger contract_addenda_parent before insert on public.contract_addenda
  for each row execute function public.guard_addendum_parent();

-- -----------------------------------------------------------------------------
-- Leitura: aditivos aprovados por concorrência (entra no "contratado" da obra).
-- SECURITY DEFINER para que o consumo da obra seja o mesmo para quem não lê contratos.
-- -----------------------------------------------------------------------------
create or replace function public.qc_work_addenda_totals(p_work_id uuid)
returns table (competition_id uuid, total text)
language sql stable security definer set search_path = public
as $$
  select cr.competition_id, sum(a.total_delta)::numeric(18, 4)::text
    from public.contract_addenda a
    join public.contract_requests cr on cr.id = a.contract_request_id
    join public.competitions c on c.id = cr.competition_id
   where c.work_id = p_work_id
     and a.status = 'approved'
     and cr.status <> 'cancelled'
     and public.auth_can_access_work(p_work_id)
   group by cr.competition_id
$$;

grant execute on function public.qc_work_addenda_totals(uuid) to authenticated;
grant select, insert, update, delete on public.contract_requests, public.contract_request_items,
  public.contract_item_allocations, public.contract_addenda, public.contract_addendum_items to authenticated;
