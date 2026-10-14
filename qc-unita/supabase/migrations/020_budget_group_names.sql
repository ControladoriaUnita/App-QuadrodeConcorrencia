-- =============================================================================
-- 020_budget_group_names.sql
-- Nome dos Itens da EAP (grupos do orçamento) escolhido no app.
--
-- A planilha de orçamentos não traz o nome dos grupos (02, 02.06...): eles chegam como "Item 02".
-- O nome dado no app fica por obra e código do item e vale para todas as versões do orçamento,
-- inclusive as próximas importações (aplicado na leitura).
-- =============================================================================

create table public.budget_group_names (
  work_id      uuid not null references public.works (id) on delete cascade,
  wbs_code     text not null,
  description  text not null check (length(trim(description)) > 0),
  updated_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  primary key (work_id, wbs_code)
);

alter table public.budget_group_names enable row level security;
create policy budget_group_names_select on public.budget_group_names for select to authenticated
  using (public.auth_has_permission('budget.read', work_id));
create policy budget_group_names_write on public.budget_group_names for all to authenticated
  using (public.auth_has_permission('budget.import', work_id))
  with check (public.auth_has_permission('budget.import', work_id));
