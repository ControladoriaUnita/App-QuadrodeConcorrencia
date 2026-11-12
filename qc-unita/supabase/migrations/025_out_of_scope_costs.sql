-- =============================================================================
-- 025_out_of_scope_costs.sql
-- Custos fora de escopo: itens que não estão previstos no orçamento da obra.
--
--   * out_of_scope_costs: um lançamento por item (insumo, quantidade, custo unitário, motivo,
--     justificativa, Item da EAP e IP opcionais). Numeração sequencial por obra (FE-001…),
--     atribuída no insert.
--   * Leitura: quem vê o orçamento da obra (budget.read). Gravação: permissão nova
--     out_of_scope.manage, concedida aos papéis que já mantêm o orçamento (budget.import).
--   * Auditoria campo a campo pelo trigger audit_row_changes (work_id na própria linha).
--   * Excluir a obra (qc_purge_work) leva os lançamentos junto (on delete cascade); o simulado
--     mantém a obra e, portanto, os lançamentos.
-- =============================================================================

create table if not exists public.out_of_scope_costs (
  id                    uuid primary key default gen_random_uuid(),
  work_id               uuid not null references public.works (id) on delete cascade,
  number                integer not null,
  code                  text check (code is null or length(trim(code)) between 1 and 40),
  description           text not null check (length(trim(description)) >= 3),
  unit                  text not null check (length(trim(unit)) >= 1),
  quantity              public.qty4 not null check (quantity > 0),
  unit_cost             public.money4 not null check (unit_cost >= 0),
  total_cost            public.money4 generated always as (round(quantity * unit_cost, 4)) stored,
  wbs_code              text check (wbs_code is null or wbs_code ~ '^\d+(\.\d+)*$'),
  wbs_description       text,
  planning_code         text,
  planning_description  text,
  category              text not null check (category in
                          ('client_request', 'budget_omission', 'design_change', 'technical_requirement', 'regulatory', 'other')),
  justification         text not null check (length(trim(justification)) >= 5),
  requested_by_name     text,
  occurred_on           date not null default current_date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id),
  updated_by            uuid references auth.users (id),
  unique (work_id, number)
);
create index if not exists out_of_scope_costs_work_idx on public.out_of_scope_costs (work_id, number);

-- Número sequencial por obra (o maior + 1). A trava consultiva da transação serializa lançamentos
-- simultâneos da mesma obra sem exigir permissão de alterar a obra.
create or replace function public.out_of_scope_next_number()
returns trigger language plpgsql
as $$
begin
  if new.number is null or new.number <= 0 then
    perform pg_advisory_xact_lock(hashtext('out_of_scope_costs:' || new.work_id::text));
    select coalesce(max(number), 0) + 1 into new.number from public.out_of_scope_costs where work_id = new.work_id;
  end if;
  return new;
end;
$$;

drop trigger if exists out_of_scope_costs_number on public.out_of_scope_costs;
create trigger out_of_scope_costs_number before insert on public.out_of_scope_costs
  for each row execute function public.out_of_scope_next_number();
drop trigger if exists out_of_scope_costs_set_updated_at on public.out_of_scope_costs;
create trigger out_of_scope_costs_set_updated_at before update on public.out_of_scope_costs
  for each row execute function public.set_updated_at();
drop trigger if exists out_of_scope_costs_audit on public.out_of_scope_costs;
create trigger out_of_scope_costs_audit after insert or update or delete on public.out_of_scope_costs
  for each row execute function public.audit_row_changes();

-- Permissão ------------------------------------------------------------------------
insert into public.permissions (key, description) values ('out_of_scope.manage', 'Lançar custos fora de escopo da obra')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_id)
select rp.role_id, p.id
  from public.role_permissions rp
  join public.permissions b on b.id = rp.permission_id and b.key = 'budget.import'
  cross join public.permissions p
 where p.key = 'out_of_scope.manage'
on conflict do nothing;

-- RLS ------------------------------------------------------------------------------
alter table public.out_of_scope_costs enable row level security;
drop policy if exists out_of_scope_costs_select on public.out_of_scope_costs;
create policy out_of_scope_costs_select on public.out_of_scope_costs for select to authenticated
  using (public.auth_has_permission('budget.read', work_id));
drop policy if exists out_of_scope_costs_write on public.out_of_scope_costs;
create policy out_of_scope_costs_write on public.out_of_scope_costs for all to authenticated
  using (public.auth_has_permission('out_of_scope.manage', work_id))
  with check (public.auth_has_permission('out_of_scope.manage', work_id));

grant select, insert, update, delete on public.out_of_scope_costs to authenticated;
