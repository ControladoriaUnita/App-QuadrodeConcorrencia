-- =============================================================================
-- 001_initial_schema.sql
-- Quadro de Concorrência (QC) · Unità Engenharia
-- Base: tipos, utilitários e cadastros (obras, orçamentos, insumos, fornecedores)
--
-- Convenções
--   * Valores monetários e quantidades: numeric(18,4). Percentuais: numeric(9,6) (0..1).
--   * Toda tabela tem created_at/updated_at; tabelas de negócio têm created_by/updated_by.
--   * Dados vindos do ERP guardam erp_id + erp_synced_at e são escritos apenas server-side.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.work_status as enum ('draft', 'not_started', 'active', 'completed', 'archived');
create type public.budget_status as enum ('draft', 'active', 'superseded');
create type public.material_kind as enum ('material', 'service', 'labor', 'equipment', 'composition', 'other');
create type public.tax_id_kind as enum ('cnpj', 'cpf');
create type public.record_source as enum ('manual', 'erp');

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    begin
      new.updated_by := auth.uid();
    exception when undefined_column then
      null;
    end;
  end if;
  return new;
end;
$$;

-- Tipos monetários padronizados
create domain public.money4 as numeric(18, 4);
create domain public.qty4 as numeric(18, 4);
create domain public.ratio6 as numeric(9, 6) check (value is null or (value >= 0 and value <= 1));

-- -----------------------------------------------------------------------------
-- Obras
-- -----------------------------------------------------------------------------
create table public.works (
  id             uuid primary key default gen_random_uuid(),
  erp_id         text unique,
  code           text not null unique,              -- Nº da obra
  name           text not null,
  client_name    text,
  city           text,
  state          char(2),
  cost_center    text,
  status         public.work_status not null default 'draft',
  started_on     date,
  finished_on    date,
  source         public.record_source not null default 'manual',
  erp_synced_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id),
  updated_by     uuid references auth.users (id)
);

-- -----------------------------------------------------------------------------
-- Catálogo de insumos (IM material · IS serviço · IP pessoal/pacote · CPU composição)
-- -----------------------------------------------------------------------------
create table public.materials (
  id             uuid primary key default gen_random_uuid(),
  erp_id         text unique,
  code           text not null unique,               -- ex.: IM08135, IS00017, IP00104
  description    text not null,
  unit           text not null,
  kind           public.material_kind not null default 'other',
  active         boolean not null default true,
  source         public.record_source not null default 'manual',
  erp_synced_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id),
  updated_by     uuid references auth.users (id)
);
create index materials_description_idx on public.materials using gin (to_tsvector('portuguese', description));

-- -----------------------------------------------------------------------------
-- Orçamentos (versões por obra) e EAP
-- -----------------------------------------------------------------------------
create table public.budgets (
  id             uuid primary key default gen_random_uuid(),
  work_id        uuid not null references public.works (id) on delete restrict,
  erp_id         text,
  version        integer not null default 1,
  description    text,
  base_date      date,
  status         public.budget_status not null default 'draft',
  is_current     boolean not null default false,
  total_amount   public.money4 not null default 0,
  source         public.record_source not null default 'manual',
  erp_synced_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id),
  updated_by     uuid references auth.users (id),
  unique (work_id, version)
);
create unique index budgets_one_current_per_work on public.budgets (work_id) where is_current;

-- Nós da EAP do orçamento (grupos "Item": 01, 02, 02.01 ...)
create table public.budget_items (
  id             uuid primary key default gen_random_uuid(),
  budget_id      uuid not null references public.budgets (id) on delete cascade,
  parent_id      uuid references public.budget_items (id) on delete cascade,
  wbs_code       text not null,                      -- 02.01
  description    text not null,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (budget_id, wbs_code)
);
create index budget_items_parent_idx on public.budget_items (parent_id);

-- Composições / serviços orçados (CPU/CPO) — "atividades" da obra
create table public.activities (
  id               uuid primary key default gen_random_uuid(),
  budget_id        uuid not null references public.budgets (id) on delete cascade,
  budget_item_id   uuid references public.budget_items (id) on delete set null,
  wbs_code         text not null,                    -- 02.02.01
  composition_code text,                             -- CPU00018
  description      text not null,
  unit             text,
  quantity         public.qty4 not null default 0,
  unit_cost        public.money4 not null default 0,
  total_cost       public.money4 generated always as (round(quantity * unit_cost, 4)) stored,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (budget_id, wbs_code)
);
create index activities_budget_item_idx on public.activities (budget_item_id);

-- Insumos que compõem cada atividade (linhas analíticas do orçamento)
create table public.activity_items (
  id                  uuid primary key default gen_random_uuid(),
  activity_id         uuid not null references public.activities (id) on delete cascade,
  budget_id           uuid not null references public.budgets (id) on delete cascade,
  material_id         uuid not null references public.materials (id),
  quantity            public.qty4 not null default 0,
  unit_cost           public.money4 not null default 0,
  total_cost          public.money4 generated always as (round(quantity * unit_cost, 4)) stored,
  package_code        text,                          -- "Vínculo PL" (ex.: IP00104)
  package_description text,                          -- ex.: Terraplenagem
  classification      text,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index activity_items_budget_material_idx on public.activity_items (budget_id, material_id);
create index activity_items_package_idx on public.activity_items (budget_id, package_code);

-- -----------------------------------------------------------------------------
-- Fornecedores
-- -----------------------------------------------------------------------------
create table public.suppliers (
  id               uuid primary key default gen_random_uuid(),
  erp_id           text unique,
  legal_name       text not null,                    -- Razão social
  trade_name       text,                             -- Fantasia
  tax_id           text not null unique,             -- CNPJ/CPF somente dígitos
  tax_id_kind      public.tax_id_kind not null default 'cnpj',
  contact_name     text,
  phone            text,
  email            text,
  cnd_valid_until  date,                             -- Validade CND
  city             text,
  state            char(2),
  active           boolean not null default true,
  source           public.record_source not null default 'manual',
  erp_synced_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id),
  updated_by       uuid references auth.users (id),
  constraint suppliers_tax_id_digits check (tax_id ~ '^[0-9]{11}$|^[0-9]{14}$')
);

-- -----------------------------------------------------------------------------
-- Tipos de contrato (minutas — aba "Listas")
-- -----------------------------------------------------------------------------
create table public.contract_types (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,              -- CTD02
  name            text not null,
  template_name   text,
  person_kind     public.tax_id_kind,
  jurisdiction    text,                              -- Foro (SP, BH, MG)
  direct_billing  boolean not null default false,    -- Com faturamento direto
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Triggers updated_at
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['works','materials','budgets','budget_items','activities','activity_items','suppliers','contract_types']
  loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;
