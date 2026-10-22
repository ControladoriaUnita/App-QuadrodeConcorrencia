-- =============================================================================
-- 022_budget_mappings_indirect.sql
-- De-para do orçamento e indireto aberto por obra.
--
--   * budget_item_mappings: nome e IP por código de Item da EAP (02, 02.06...). Primeira visão de
--     toda obra: o nome troca o "Item 02" genérico na leitura; o IP vai para as linhas abaixo do Item
--     ao gravar cada versão do orçamento do SharePoint. Nome e IP dados na obra valem sobre ele.
--   * indirect_planning_mappings: IP por insumo do indireto (pela descrição sem acento/caixa).
--   * work_indirect_costs: indireto aberto importado do arquivo da obra, reaplicado a cada versão.
--
-- Gravação só pelo servidor (service_role) depois de conferida a permissão; leitura liberada a
-- quem mantém o catálogo (de-para) ou vê o orçamento da obra (indireto).
-- =============================================================================

create table if not exists public.budget_item_mappings (
  wbs_code              text primary key check (wbs_code ~ '^\d+(\.\d+)*$'),
  description           text check (description is null or length(trim(description)) > 0),
  planning_code         text,
  planning_description  text,
  updated_by            uuid references auth.users (id),
  updated_at            timestamptz not null default now(),
  check (description is not null or planning_code is not null)
);

create table if not exists public.indirect_planning_mappings (
  description_key       text primary key,
  description           text not null check (length(trim(description)) > 0),
  planning_code         text not null,
  planning_description  text,
  updated_by            uuid references auth.users (id),
  updated_at            timestamptz not null default now()
);

create table if not exists public.work_indirect_costs (
  work_id      uuid primary key references public.works (id) on delete cascade,
  file_name    text not null,
  -- Itens e insumos lidos do arquivo (shared/domain/budget/indirect-import.ts → IndirectBudget)
  payload      jsonb not null,
  imported_by  uuid references auth.users (id),
  imported_at  timestamptz not null default now()
);

alter table public.budget_item_mappings enable row level security;
alter table public.indirect_planning_mappings enable row level security;
alter table public.work_indirect_costs enable row level security;

drop policy if exists budget_item_mappings_select on public.budget_item_mappings;
create policy budget_item_mappings_select on public.budget_item_mappings for select to authenticated
  using (public.auth_has_permission('catalog.manage'));
drop policy if exists indirect_planning_mappings_select on public.indirect_planning_mappings;
create policy indirect_planning_mappings_select on public.indirect_planning_mappings for select to authenticated
  using (public.auth_has_permission('catalog.manage'));
drop policy if exists work_indirect_costs_select on public.work_indirect_costs;
create policy work_indirect_costs_select on public.work_indirect_costs for select to authenticated
  using (public.auth_has_permission('budget.read', work_id));
