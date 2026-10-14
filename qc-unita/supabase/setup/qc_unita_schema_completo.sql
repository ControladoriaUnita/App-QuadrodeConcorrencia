-- =============================================================================
-- Quadro de Concorrência · Unità Engenharia — schema completo
-- GERADO por scripts/build-db-setup.mjs a partir de 20 migrations
-- (001_initial_schema.sql … 020_budget_group_names.sql). Não edite à mão: altere a migration e rode npm run db:bundle.
--
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Roda numa única transação: se algo falhar, nada fica pela metade.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.works') is not null then
    raise exception 'O schema do QC já existe neste banco (public.works). Rode só as migrations que faltam.';
  end if;
end $$;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 001_initial_schema.sql
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

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 002_rbac.sql
-- =============================================================================
-- 002_rbac.sql
-- Perfis, papéis, permissões e escopo por obra
--
-- Modelo: user_roles(user_id, role_id, work_id NULL = global).
-- Um usuário pode ser "Engenharia" apenas na obra X e "Visualizador" global.
-- =============================================================================

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text,
  job_title   text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,       -- admin | procurement | engineering | manager | director | viewer
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,       -- competition.edit, approval.decide ...
  description text not null,
  created_at  timestamptz not null default now()
);

create table public.role_permissions (
  role_id       uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete cascade,
  work_id     uuid references public.works (id) on delete cascade,   -- NULL = todas as obras
  granted_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
create unique index user_roles_unique on public.user_roles (user_id, role_id, work_id) nulls not distinct;
create index user_roles_user_idx on public.user_roles (user_id);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger roles_set_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Funções de autorização (usadas pelas políticas RLS)
-- SECURITY DEFINER para evitar recursão de RLS; search_path fixo.
-- -----------------------------------------------------------------------------
create or replace function public.auth_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where ur.user_id = auth.uid()
       and r.key = 'admin'
       and ur.work_id is null
  );
$$;

create or replace function public.auth_has_permission(p_permission text, p_work_id uuid default null)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions p on p.id = rp.permission_id
      join public.profiles pr on pr.id = ur.user_id and pr.active
     where ur.user_id = auth.uid()
       and p.key = p_permission
       and (ur.work_id is null or ur.work_id = p_work_id)
  );
$$;

create or replace function public.auth_can_access_work(p_work_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles pr on pr.id = ur.user_id and pr.active
     where ur.user_id = auth.uid()
       and (ur.work_id is null or ur.work_id = p_work_id)
  );
$$;

-- Usuário possui o papel informado (global ou na obra)?
create or replace function public.auth_has_role(p_role_id uuid, p_work_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
     where ur.user_id = auth.uid()
       and ur.role_id = p_role_id
       and (ur.work_id is null or ur.work_id = p_work_id)
  );
$$;

-- Lista de permissões efetivas do usuário logado (consumida pela API/UI)
create or replace function public.auth_my_permissions()
returns table (permission text, work_id uuid)
language sql stable security definer set search_path = public
as $$
  select distinct p.key, ur.work_id
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
   where ur.user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Novo usuário → cria apenas o perfil. Papéis são concedidos explicitamente por um
-- administrador (princípio do menor privilégio: sem papel, nenhuma obra é visível).
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 003_competitions.sql
-- =============================================================================
-- 003_competitions.sql
-- Concorrências, revisões, itens, fornecedores convidados, propostas e
-- melhores condições.
--
-- Regra de imutabilidade: uma revisão aprovada (frozen_at não nulo) e todos os
-- seus filhos ficam congelados. Sincronizações do ERP nunca alteram revisões
-- aprovadas — os valores orçados são copiados para competition_items no momento
-- da montagem do QC e o snapshot JSON completo é gravado na aprovação.
-- =============================================================================

create type public.competition_status as enum ('open', 'in_approval', 'approved', 'contracted', 'cancelled');
create type public.revision_status as enum ('draft', 'in_approval', 'approved', 'rejected', 'superseded');
create type public.competition_supplier_status as enum ('invited', 'responded', 'declined', 'disqualified');

-- -----------------------------------------------------------------------------
-- Concorrência (cabeçalho estável ao longo das revisões)
-- -----------------------------------------------------------------------------
create table public.competitions (
  id                   uuid primary key default gen_random_uuid(),
  work_id              uuid not null references public.works (id) on delete restrict,
  budget_id            uuid not null references public.budgets (id) on delete restrict,
  code                 text not null,                       -- QC-0001 (sequencial por obra)
  title                text not null,                       -- Objeto
  description          text,
  package_code         text,                                -- Pacote de licitação (Vínculo PL)
  status               public.competition_status not null default 'open',
  current_revision_id  uuid,                                -- FK adicionada abaixo
  requested_on         date not null default current_date,  -- Data da solicitação
  engineering_owner_id uuid references public.profiles (id),-- Eng. responsável
  procurement_owner_id uuid references public.profiles (id),-- Suprimentos responsável
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id),
  updated_by           uuid references auth.users (id),
  unique (work_id, code)
);
create index competitions_work_idx on public.competitions (work_id, status);

-- -----------------------------------------------------------------------------
-- Revisões (rev00, rev01 ...)
-- -----------------------------------------------------------------------------
create table public.competition_revisions (
  id                        uuid primary key default gen_random_uuid(),
  competition_id            uuid not null references public.competitions (id) on delete cascade,
  number                    integer not null check (number >= 0),
  status                    public.revision_status not null default 'draft',
  based_on_revision_id      uuid references public.competition_revisions (id),
  reason                    text,                               -- Motivo da revisão
  service_start_on          date,                               -- Início do serviço
  service_end_on            date,                               -- Término do serviço
  budget_amount             public.money4 not null default 0,   -- Total orçado
  budget_used_amount        public.money4 not null default 0,   -- Verba já utilizada
  budget_adjustment_amount  public.money4 not null default 0,   -- Acréscimos/Reduções
  engineering_notes         text,
  procurement_notes         text,
  contract_type_id          uuid references public.contract_types (id),
  winner_supplier_id        uuid references public.suppliers (id),
  winner_justification      text,
  submitted_at              timestamptz,
  submitted_by              uuid references auth.users (id),
  decided_at                timestamptz,
  snapshot                  jsonb,                              -- Retrato congelado na aprovação
  snapshot_hash             text,                               -- sha256 do snapshot
  frozen_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references auth.users (id),
  updated_by                uuid references auth.users (id),
  unique (competition_id, number),
  constraint revision_dates_ok check (service_end_on is null or service_start_on is null or service_end_on >= service_start_on),
  constraint revision_frozen_has_snapshot check (frozen_at is null or (snapshot is not null and snapshot_hash is not null))
);
-- Apenas uma revisão "viva" (rascunho ou em aprovação) por concorrência
create unique index competition_revisions_one_open
  on public.competition_revisions (competition_id) where status in ('draft', 'in_approval');

alter table public.competitions
  add constraint competitions_current_revision_fk
  foreign key (current_revision_id) references public.competition_revisions (id) deferrable initially deferred;

-- -----------------------------------------------------------------------------
-- Itens do QC (cópia dos dados orçados + escopo equalizado)
-- -----------------------------------------------------------------------------
create table public.competition_items (
  id                 uuid primary key default gen_random_uuid(),
  revision_id        uuid not null references public.competition_revisions (id) on delete cascade,
  material_id        uuid references public.materials (id),
  sort_order         integer not null default 0,               -- Ordem
  code               text not null,                            -- Código insumo
  description        text not null,
  unit               text not null,
  budget_quantity    public.qty4 not null default 0,           -- QUANT. orçada
  budget_unit_cost   public.money4 not null default 0,         -- R$ UNIT. orçado
  budget_total       public.money4 generated always as (round(budget_quantity * budget_unit_cost, 4)) stored,
  quantity           public.qty4 not null default 0,           -- QUANT. equalizada (escopo)
  scope_description  text,                                     -- Escopo dos serviços
  contract_notes     text,                                     -- Obs. contratos
  pct_material       public.ratio6 not null default 0,
  pct_equipment      public.ratio6 not null default 0,
  pct_retention      public.ratio6 not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint competition_items_pct_sum check (pct_material + pct_equipment <= 1)
);
create index competition_items_revision_idx on public.competition_items (revision_id, sort_order);

-- -----------------------------------------------------------------------------
-- Fornecedores participantes (dados cadastrais copiados para a revisão)
-- -----------------------------------------------------------------------------
create table public.competition_suppliers (
  id                  uuid primary key default gen_random_uuid(),
  revision_id         uuid not null references public.competition_revisions (id) on delete cascade,
  supplier_id         uuid not null references public.suppliers (id),
  sort_order          integer not null default 0,
  status              public.competition_supplier_status not null default 'invited',
  legal_name          text not null,
  trade_name          text,
  tax_id              text not null,
  contact_name        text,
  phone               text,
  email               text,
  cnd_valid_until     date,
  delivery_terms      text,   -- Prazo de execução / entrega
  payment_terms       text,   -- Condição de pagamento
  readjustment_terms  text,   -- Forma de reajuste
  notes               text,   -- Observações
  strengths           text,   -- Pontos positivos
  weaknesses          text,   -- Pontos negativos
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (revision_id, supplier_id)
);

-- -----------------------------------------------------------------------------
-- Propostas
-- -----------------------------------------------------------------------------
create table public.supplier_proposals (
  id                      uuid primary key default gen_random_uuid(),
  revision_id             uuid not null references public.competition_revisions (id) on delete cascade,
  competition_supplier_id uuid not null unique references public.competition_suppliers (id) on delete cascade,
  proposal_ref            text,
  received_on             date,
  valid_until             date,
  total_amount            public.money4 not null default 0,    -- R$ total equalizado (calculado no domínio)
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references auth.users (id),
  updated_by              uuid references auth.users (id)
);

create table public.supplier_proposal_items (
  id                  uuid primary key default gen_random_uuid(),
  proposal_id         uuid not null references public.supplier_proposals (id) on delete cascade,
  competition_item_id uuid not null references public.competition_items (id) on delete cascade,
  unit_price          public.money4,            -- NULL = não cotado
  total_price         public.money4,            -- calculado no domínio (unit × quantidade equalizada)
  notes               text,                     -- OBS
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (proposal_id, competition_item_id),
  constraint proposal_item_price_positive check (unit_price is null or unit_price >= 0)
);

-- -----------------------------------------------------------------------------
-- Melhores condições (resultado calculado pelo domínio, persistido para consulta)
-- -----------------------------------------------------------------------------
create table public.best_conditions (
  id                      uuid primary key default gen_random_uuid(),
  revision_id             uuid not null references public.competition_revisions (id) on delete cascade,
  competition_item_id     uuid not null unique references public.competition_items (id) on delete cascade,
  competition_supplier_id uuid references public.competition_suppliers (id) on delete set null,
  unit_price              public.money4,
  total_price             public.money4,
  budget_total            public.money4,
  variance_amount         public.money4,        -- orçado − melhor (positivo = economia)
  variance_ratio          numeric(12, 6),
  is_override             boolean not null default false,
  override_reason         text,
  computed_at             timestamptz not null default now(),
  constraint best_condition_override_reason check (not is_override or coalesce(trim(override_reason), '') <> '')
);
create index best_conditions_revision_idx on public.best_conditions (revision_id);

-- -----------------------------------------------------------------------------
-- updated_at
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['competitions','competition_revisions','competition_items','competition_suppliers','supplier_proposals','supplier_proposal_items']
  loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Helpers de escopo (usados por RLS e auditoria)
-- -----------------------------------------------------------------------------
create or replace function public.competition_work_id(p_competition_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select work_id from public.competitions where id = p_competition_id $$;

create or replace function public.revision_work_id(p_revision_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select c.work_id
    from public.competition_revisions r
    join public.competitions c on c.id = r.competition_id
   where r.id = p_revision_id
$$;

create or replace function public.proposal_revision_id(p_proposal_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select revision_id from public.supplier_proposals where id = p_proposal_id $$;

create or replace function public.budget_work_id(p_budget_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select work_id from public.budgets where id = p_budget_id $$;

-- -----------------------------------------------------------------------------
-- Imutabilidade de revisões congeladas
-- -----------------------------------------------------------------------------
create or replace function public.revision_is_frozen(p_revision_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select frozen_at is not null from public.competition_revisions where id = p_revision_id), false) $$;

-- Filhos de revisão: bloqueia INSERT/UPDATE/DELETE quando a revisão está congelada
create or replace function public.guard_frozen_revision_child()
returns trigger language plpgsql
as $$
declare
  v_revision uuid;
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  v_revision := coalesce(
    (v_row ->> 'revision_id')::uuid,
    public.proposal_revision_id((v_row ->> 'proposal_id')::uuid)
  );
  if v_revision is not null and public.revision_is_frozen(v_revision) then
    raise exception 'QC_REVISION_FROZEN: a revisão % está aprovada e não pode ser alterada', v_revision
      using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['competition_items','competition_suppliers','supplier_proposals','supplier_proposal_items','best_conditions']
  loop
    execute format('create trigger %I_guard_frozen before insert or update or delete on public.%I for each row execute function public.guard_frozen_revision_child()', t, t);
  end loop;
end $$;

-- Revisão: após congelada, só aceita a transição approved → superseded
create or replace function public.guard_frozen_revision()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.frozen_at is not null then
      raise exception 'QC_REVISION_FROZEN: revisão aprovada não pode ser excluída' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.frozen_at is not null then
    if not (old.status = 'approved' and new.status = 'superseded'
            and (to_jsonb(new) - 'status' - 'updated_at' - 'updated_by')
              = (to_jsonb(old) - 'status' - 'updated_at' - 'updated_by')) then
      raise exception 'QC_REVISION_FROZEN: revisão % congelada', old.id using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger competition_revisions_guard_frozen
  before update or delete on public.competition_revisions
  for each row execute function public.guard_frozen_revision();

-- -----------------------------------------------------------------------------
-- Clonagem atômica de revisão (infraestrutura; a regra de QUANDO clonar fica no domínio)
-- -----------------------------------------------------------------------------
create or replace function public.qc_clone_revision(p_revision_id uuid, p_reason text)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_src  public.competition_revisions;
  v_new  uuid := gen_random_uuid();
  v_next integer;
begin
  select * into v_src from public.competition_revisions where id = p_revision_id;
  if not found then
    raise exception 'QC_REVISION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(max(number), -1) + 1 into v_next
    from public.competition_revisions where competition_id = v_src.competition_id;

  insert into public.competition_revisions (
    id, competition_id, number, status, based_on_revision_id, reason,
    service_start_on, service_end_on, budget_amount, budget_used_amount, budget_adjustment_amount,
    engineering_notes, procurement_notes, contract_type_id, created_by)
  values (
    v_new, v_src.competition_id, v_next, 'draft', v_src.id, p_reason,
    v_src.service_start_on, v_src.service_end_on, v_src.budget_amount, v_src.budget_used_amount,
    v_src.budget_adjustment_amount, v_src.engineering_notes, v_src.procurement_notes,
    v_src.contract_type_id, auth.uid());

  create temporary table _item_map (old_id uuid, new_id uuid) on commit drop;
  insert into _item_map select id, gen_random_uuid() from public.competition_items where revision_id = v_src.id;

  insert into public.competition_items (
    id, revision_id, material_id, sort_order, code, description, unit, budget_quantity, budget_unit_cost,
    quantity, scope_description, contract_notes, pct_material, pct_equipment, pct_retention)
  select m.new_id, v_new, i.material_id, i.sort_order, i.code, i.description, i.unit, i.budget_quantity,
         i.budget_unit_cost, i.quantity, i.scope_description, i.contract_notes, i.pct_material,
         i.pct_equipment, i.pct_retention
    from public.competition_items i join _item_map m on m.old_id = i.id;

  create temporary table _sup_map (old_id uuid, new_id uuid) on commit drop;
  insert into _sup_map select id, gen_random_uuid() from public.competition_suppliers where revision_id = v_src.id;

  insert into public.competition_suppliers (
    id, revision_id, supplier_id, sort_order, status, legal_name, trade_name, tax_id, contact_name, phone,
    email, cnd_valid_until, delivery_terms, payment_terms, readjustment_terms, notes, strengths, weaknesses)
  select m.new_id, v_new, s.supplier_id, s.sort_order, s.status, s.legal_name, s.trade_name, s.tax_id,
         s.contact_name, s.phone, s.email, s.cnd_valid_until, s.delivery_terms, s.payment_terms,
         s.readjustment_terms, s.notes, s.strengths, s.weaknesses
    from public.competition_suppliers s join _sup_map m on m.old_id = s.id;

  create temporary table _prop_map (old_id uuid, new_id uuid) on commit drop;
  insert into _prop_map select id, gen_random_uuid() from public.supplier_proposals where revision_id = v_src.id;

  insert into public.supplier_proposals (
    id, revision_id, competition_supplier_id, proposal_ref, received_on, valid_until, total_amount, notes, created_by)
  select pm.new_id, v_new, sm.new_id, p.proposal_ref, p.received_on, p.valid_until, p.total_amount, p.notes, auth.uid()
    from public.supplier_proposals p
    join _prop_map pm on pm.old_id = p.id
    join _sup_map sm on sm.old_id = p.competition_supplier_id;

  insert into public.supplier_proposal_items (proposal_id, competition_item_id, unit_price, total_price, notes)
  select pm.new_id, im.new_id, pi.unit_price, pi.total_price, pi.notes
    from public.supplier_proposal_items pi
    join _prop_map pm on pm.old_id = pi.proposal_id
    join _item_map im on im.old_id = pi.competition_item_id;

  update public.competitions set current_revision_id = v_new, status = 'open' where id = v_src.competition_id;

  return v_new;
end;
$$;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 004_approvals_contracts.sql
-- =============================================================================
-- 004_approvals_contracts.sql
-- Fluxo de aprovações, solicitações de contrato, aditivos e anexos (Storage)
-- =============================================================================

create type public.approval_status as enum ('pending', 'approved', 'rejected', 'skipped');
create type public.contract_request_status as enum ('draft', 'submitted', 'sent_to_erp', 'signed', 'cancelled');
create type public.addendum_status as enum ('draft', 'submitted', 'approved', 'rejected', 'sent_to_erp');
create type public.attachment_category as enum ('proposal', 'memorial', 'addendum', 'supplier_document', 'contract', 'other');

-- -----------------------------------------------------------------------------
-- Configuração do fluxo (etapas sequenciais, opcionalmente por faixa de valor)
-- -----------------------------------------------------------------------------
create table public.approval_steps (
  id           uuid primary key default gen_random_uuid(),
  step_order   integer not null unique,
  name         text not null,                         -- Suprimentos, Engenharia, Gerente/Coordenador, Diretoria
  role_id      uuid not null references public.roles (id),
  min_amount   public.money4,                         -- etapa exigida somente a partir deste valor
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Instâncias por revisão (geradas no envio para aprovação)
create table public.approvals (
  id           uuid primary key default gen_random_uuid(),
  revision_id  uuid not null references public.competition_revisions (id) on delete cascade,
  step_order   integer not null,
  step_name    text not null,
  role_id      uuid not null references public.roles (id),
  status       public.approval_status not null default 'pending',
  decided_by   uuid references auth.users (id),
  decided_at   timestamptz,
  comment      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (revision_id, step_order),
  constraint approvals_decision_consistent check (
    (status in ('pending', 'skipped') and decided_at is null)
    or (status in ('approved', 'rejected') and decided_at is not null and decided_by is not null)
  ),
  constraint approvals_reject_needs_comment check (status <> 'rejected' or coalesce(trim(comment), '') <> '')
);
create index approvals_pending_idx on public.approvals (role_id) where status = 'pending';

-- -----------------------------------------------------------------------------
-- Solicitação de contrato (gerada a partir de revisão aprovada)
-- -----------------------------------------------------------------------------
create table public.contract_requests (
  id                         uuid primary key default gen_random_uuid(),
  competition_id             uuid not null references public.competitions (id) on delete restrict,
  revision_id                uuid not null references public.competition_revisions (id) on delete restrict,
  supplier_id                uuid not null references public.suppliers (id),
  second_supplier_id         uuid references public.suppliers (id),   -- 2º contratado (faturamento direto)
  contract_type_id           uuid not null references public.contract_types (id),
  code                       text not null unique,
  status                     public.contract_request_status not null default 'draft',
  start_on                   date not null,
  end_on                     date not null,
  total_amount               public.money4 not null default 0,
  pct_material               public.ratio6 not null default 0,
  pct_equipment              public.ratio6 not null default 0,
  pct_service                public.ratio6 not null default 0,
  erp_contract_id            text,                                     -- Nº do contrato no UAU
  notes                      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  created_by                 uuid references auth.users (id),
  updated_by                 uuid references auth.users (id),
  constraint contract_dates_ok check (end_on >= start_on)
);

create table public.contract_request_items (
  id                    uuid primary key default gen_random_uuid(),
  contract_request_id   uuid not null references public.contract_requests (id) on delete cascade,
  competition_item_id   uuid references public.competition_items (id),
  material_id           uuid references public.materials (id),
  code                  text not null,
  description           text not null,
  specification         text,
  unit                  text not null,
  quantity              public.qty4 not null,
  unit_price            public.money4 not null,
  total_price           public.money4 generated always as (round(quantity * unit_price, 4)) stored,
  pct_retention         public.ratio6 not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Vínculos de quantidade por local (blocos/pavimentos) e pacote orçamentário
create table public.contract_item_allocations (
  id                        uuid primary key default gen_random_uuid(),
  contract_request_item_id  uuid not null references public.contract_request_items (id) on delete cascade,
  package_code              text,             -- IP vinculado
  location_code             text,             -- BL001 / SUB-01 / TÉRREO ...
  quantity                  public.qty4 not null,
  created_at                timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Aditivos
-- -----------------------------------------------------------------------------
create table public.contract_addenda (
  id                   uuid primary key default gen_random_uuid(),
  contract_request_id  uuid not null references public.contract_requests (id) on delete restrict,
  number               integer not null check (number >= 1),
  reason               text not null,
  requested_on         date not null default current_date,
  new_end_on           date,
  status               public.addendum_status not null default 'draft',
  total_delta          public.money4 not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id),
  updated_by           uuid references auth.users (id),
  unique (contract_request_id, number)
);

create table public.contract_addendum_items (
  id                        uuid primary key default gen_random_uuid(),
  addendum_id               uuid not null references public.contract_addenda (id) on delete cascade,
  contract_request_item_id  uuid references public.contract_request_items (id),
  material_id               uuid references public.materials (id),
  code                      text not null,
  description               text not null,
  unit                      text not null,
  quantity_delta            public.qty4 not null,
  unit_price                public.money4 not null,
  total_delta               public.money4 generated always as (round(quantity_delta * unit_price, 4)) stored,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Anexos (metadados; o binário fica no Supabase Storage)
-- -----------------------------------------------------------------------------
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  work_id       uuid not null references public.works (id) on delete restrict,
  entity_type   text not null check (entity_type in (
                  'competition', 'competition_revision', 'supplier_proposal', 'supplier',
                  'contract_request', 'contract_addendum')),
  entity_id     uuid not null,
  category      public.attachment_category not null default 'other',
  bucket        text not null default 'qc-attachments',
  storage_path  text not null unique,          -- {work_id}/{entity_type}/{entity_id}/{uuid}-{arquivo}
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  checksum      text,
  uploaded_by   uuid references auth.users (id) default auth.uid(),
  uploaded_at   timestamptz not null default now()
);
create index attachments_entity_idx on public.attachments (entity_type, entity_id);

do $$
declare t text;
begin
  foreach t in array array['approval_steps','approvals','contract_requests','contract_request_items','contract_addenda','contract_addendum_items']
  loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- Aprovações de revisão congelada também não mudam
create trigger approvals_guard_frozen before insert or delete on public.approvals
  for each row execute function public.guard_frozen_revision_child();

-- Escopo por obra para tabelas de contrato
create or replace function public.contract_request_work_id(p_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select c.work_id from public.contract_requests cr join public.competitions c on c.id = cr.competition_id where cr.id = p_id
$$;

create or replace function public.addendum_work_id(p_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select public.contract_request_work_id(contract_request_id) from public.contract_addenda where id = p_id
$$;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 005_audit.sql
-- =============================================================================
-- 005_audit.sql
-- Auditoria obrigatória (campo a campo) e logs de integração ERP
--
-- Contexto da auditoria — propagado pela API via headers do PostgREST:
--   x-audit-origin   : ui | api | erp_sync | system | migration
--   x-correlation-id : id da requisição (rastreio ponta a ponta)
--   x-revision-id    : revisão ativa no momento da alteração (opcional)
--   x-actor-id       : usuário real quando a chamada usa service_role
--                      (aceito SOMENTE se o JWT for service_role)
-- =============================================================================

create type public.audit_action as enum ('insert', 'update', 'delete');
create type public.integration_status as enum ('started', 'success', 'partial', 'error');

create table public.audit_logs (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  user_id         uuid,                                 -- quem
  entity          text not null,                        -- tabela
  entity_id       uuid,
  action          public.audit_action not null,
  field           text,                                 -- campo (NULL em insert/delete = linha inteira)
  old_value       jsonb,
  new_value       jsonb,
  revision_id     uuid,                                 -- revisão ativa
  work_id         uuid,
  origin          text not null default 'system',       -- origem da alteração
  correlation_id  text
);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id, occurred_at desc);
create index audit_logs_revision_idx on public.audit_logs (revision_id, occurred_at desc) where revision_id is not null;
create index audit_logs_user_idx on public.audit_logs (user_id, occurred_at desc);

create table public.integration_logs (
  id                 uuid primary key default gen_random_uuid(),
  correlation_id     text not null,
  provider           text not null,                    -- mock | uau | senior
  operation          text not null,                    -- getWorks, syncBudget ...
  direction          text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  integration_id     text,                             -- id externo da entidade/lote
  status             public.integration_status not null default 'started',
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  records_processed  integer not null default 0,
  records_failed     integer not null default 0,
  message            text,
  error_detail       jsonb,
  payload_summary    jsonb,
  triggered_by       uuid references auth.users (id)
);
create index integration_logs_corr_idx on public.integration_logs (correlation_id);
create index integration_logs_started_idx on public.integration_logs (started_at desc);

-- -----------------------------------------------------------------------------
-- Contexto
-- -----------------------------------------------------------------------------
create or replace function public.audit_request_header(p_name text)
returns text language sql stable
as $$
  select nullif(current_setting('request.headers', true), '')::jsonb ->> p_name
$$;

create or replace function public.audit_actor_id()
returns uuid language plpgsql stable
as $$
declare
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_hdr  text;
begin
  if auth.uid() is not null then
    return auth.uid();
  end if;
  if v_role = 'service_role' then
    v_hdr := public.audit_request_header('x-actor-id');
    if v_hdr ~* '^[0-9a-f-]{36}$' then
      return v_hdr::uuid;
    end if;
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Trigger genérico campo a campo
-- -----------------------------------------------------------------------------
create or replace function public.audit_row_changes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old       jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new       jsonb := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) end;
  v_row       jsonb := coalesce(v_new, v_old);
  v_actor     uuid := public.audit_actor_id();
  v_origin    text := coalesce(public.audit_request_header('x-audit-origin'),
                               case when current_setting('request.headers', true) is null then 'system' else 'api' end);
  v_corr      text := public.audit_request_header('x-correlation-id');
  v_revision  uuid;
  v_work      uuid;
  v_key       text;
  v_ignored   text[] := array['updated_at', 'updated_by', 'created_at'];
begin
  -- revisão ativa
  v_revision := coalesce(
    (v_row ->> 'revision_id')::uuid,
    case when tg_table_name = 'competition_revisions' then (v_row ->> 'id')::uuid end,
    case when tg_table_name = 'supplier_proposal_items' then public.proposal_revision_id((v_row ->> 'proposal_id')::uuid) end,
    nullif(public.audit_request_header('x-revision-id'), '')::uuid
  );

  -- obra (para filtro de RLS)
  v_work := coalesce(
    (v_row ->> 'work_id')::uuid,
    case when tg_table_name = 'competition_revisions' then public.competition_work_id((v_row ->> 'competition_id')::uuid) end,
    case when v_revision is not null then public.revision_work_id(v_revision) end,
    case when tg_table_name = 'contract_requests' then public.competition_work_id((v_row ->> 'competition_id')::uuid) end,
    case when v_row ? 'contract_request_id' then public.contract_request_work_id((v_row ->> 'contract_request_id')::uuid) end,
    case when v_row ? 'addendum_id' then public.addendum_work_id((v_row ->> 'addendum_id')::uuid) end,
    case when tg_table_name = 'works' then (v_row ->> 'id')::uuid end
  );

  if tg_op = 'INSERT' then
    insert into public.audit_logs (user_id, entity, entity_id, action, field, old_value, new_value, revision_id, work_id, origin, correlation_id)
    values (v_actor, tg_table_name, (v_row ->> 'id')::uuid, 'insert', null, null, v_new, v_revision, v_work, v_origin, v_corr);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs (user_id, entity, entity_id, action, field, old_value, new_value, revision_id, work_id, origin, correlation_id)
    values (v_actor, tg_table_name, (v_row ->> 'id')::uuid, 'delete', null, v_old, null, v_revision, v_work, v_origin, v_corr);
    return old;
  end if;

  for v_key in select jsonb_object_keys(v_new)
  loop
    continue when v_key = any (v_ignored);
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.audit_logs (user_id, entity, entity_id, action, field, old_value, new_value, revision_id, work_id, origin, correlation_id)
      values (v_actor, tg_table_name, (v_row ->> 'id')::uuid, 'update', v_key, v_old -> v_key, v_new -> v_key,
              v_revision, v_work, v_origin, v_corr);
    end if;
  end loop;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'works', 'budgets', 'suppliers', 'contract_types',
    'competitions', 'competition_revisions', 'competition_items', 'competition_suppliers',
    'supplier_proposals', 'supplier_proposal_items', 'best_conditions',
    'approval_steps', 'approvals',
    'contract_requests', 'contract_request_items', 'contract_addenda', 'contract_addendum_items',
    'attachments', 'user_roles', 'role_permissions'
  ]
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_changes()', t, t);
  end loop;
end $$;

-- role_permissions não tem coluna id; o trigger grava entity_id nulo (identificação vai em new_value/old_value).

-- -----------------------------------------------------------------------------
-- audit_logs é append-only
-- -----------------------------------------------------------------------------
create or replace function public.audit_logs_immutable()
returns trigger language plpgsql
as $$
begin
  raise exception 'audit_logs é somente inserção' using errcode = 'P0001';
end;
$$;

create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

revoke update, delete, truncate on public.audit_logs from anon, authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 006_rls.sql
-- =============================================================================
-- 006_rls.sql
-- Row Level Security em TODAS as tabelas.
--
-- Princípios
--   * Leitura: usuário precisa ter acesso à obra (papel global ou na obra) + permissão de leitura.
--   * Escrita: permissão específica, avaliada no escopo da obra.
--   * Dados do ERP (orçamentos, atividades, insumos) só são escritos pela API com service_role,
--     que ignora RLS — o client nunca tem essa chave.
--   * audit_logs: inserção só via trigger (SECURITY DEFINER); leitura com audit.read.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'works','materials','budgets','budget_items','activities','activity_items','suppliers','contract_types',
    'profiles','roles','permissions','role_permissions','user_roles',
    'competitions','competition_revisions','competition_items','competition_suppliers',
    'supplier_proposals','supplier_proposal_items','best_conditions',
    'approval_steps','approvals','contract_requests','contract_request_items','contract_item_allocations',
    'contract_addenda','contract_addendum_items','attachments','audit_logs','integration_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Observação: não usamos FORCE RLS — as funções SECURITY DEFINER (helpers de autorização e
-- trigger de auditoria) pertencem ao owner das tabelas e precisam ler/escrever sem recursão de RLS.
-- Nenhuma política de INSERT existe em audit_logs: clientes não conseguem escrever diretamente.

-- -----------------------------------------------------------------------------
-- RBAC
-- -----------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid() or public.auth_is_admin())
  with check (id = auth.uid() or public.auth_is_admin());

create policy roles_select on public.roles for select to authenticated using (true);
create policy roles_admin on public.roles for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

create policy permissions_select on public.permissions for select to authenticated using (true);
create policy permissions_admin on public.permissions for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
create policy role_permissions_admin on public.role_permissions for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.auth_is_admin());
create policy user_roles_admin on public.user_roles for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

-- -----------------------------------------------------------------------------
-- Cadastros
-- -----------------------------------------------------------------------------
create policy works_select on public.works for select to authenticated
  using (public.auth_can_access_work(id) and public.auth_has_permission('work.read', id));
create policy works_insert on public.works for insert to authenticated
  with check (public.auth_has_permission('work.manage'));
create policy works_update on public.works for update to authenticated
  using (public.auth_has_permission('work.manage', id)) with check (public.auth_has_permission('work.manage', id));

create policy materials_select on public.materials for select to authenticated using (true);
create policy materials_write on public.materials for all to authenticated
  using (public.auth_has_permission('catalog.manage')) with check (public.auth_has_permission('catalog.manage'));

create policy suppliers_select on public.suppliers for select to authenticated
  using (public.auth_has_permission('supplier.read'));
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.auth_has_permission('supplier.manage')) with check (public.auth_has_permission('supplier.manage'));

create policy contract_types_select on public.contract_types for select to authenticated using (true);
create policy contract_types_write on public.contract_types for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

-- Orçamento: somente leitura para usuários (escrita via service_role / ERP)
create policy budgets_select on public.budgets for select to authenticated
  using (public.auth_has_permission('budget.read', work_id));
create policy budget_items_select on public.budget_items for select to authenticated
  using (public.auth_has_permission('budget.read', public.budget_work_id(budget_id)));
create policy activities_select on public.activities for select to authenticated
  using (public.auth_has_permission('budget.read', public.budget_work_id(budget_id)));
create policy activity_items_select on public.activity_items for select to authenticated
  using (public.auth_has_permission('budget.read', public.budget_work_id(budget_id)));

-- -----------------------------------------------------------------------------
-- Concorrências
-- -----------------------------------------------------------------------------
create policy competitions_select on public.competitions for select to authenticated
  using (public.auth_has_permission('competition.read', work_id));
create policy competitions_insert on public.competitions for insert to authenticated
  with check (public.auth_has_permission('competition.create', work_id));
-- approval.decide também atualiza (status/revisão corrente ao concluir o fluxo de aprovação)
create policy competitions_update on public.competitions for update to authenticated
  using (public.auth_has_permission('competition.edit', work_id) or public.auth_has_permission('approval.decide', work_id))
  with check (public.auth_has_permission('competition.edit', work_id) or public.auth_has_permission('approval.decide', work_id));

create policy revisions_select on public.competition_revisions for select to authenticated
  using (public.auth_has_permission('competition.read', public.competition_work_id(competition_id)));
create policy revisions_insert on public.competition_revisions for insert to authenticated
  with check (public.auth_has_permission('competition.edit', public.competition_work_id(competition_id)));
create policy revisions_update on public.competition_revisions for update to authenticated
  using (public.auth_has_permission('competition.edit', public.competition_work_id(competition_id))
         or public.auth_has_permission('approval.decide', public.competition_work_id(competition_id)))
  with check (public.auth_has_permission('competition.edit', public.competition_work_id(competition_id))
         or public.auth_has_permission('approval.decide', public.competition_work_id(competition_id)));

-- Filhos da revisão
do $$
declare
  t text;
  perm text;
begin
  for t, perm in select * from (values
      ('competition_items', 'competition.edit'),
      ('competition_suppliers', 'competition.edit'),
      ('supplier_proposals', 'proposal.edit'),
      ('best_conditions', 'competition.edit')) as v(t, perm)
  loop
    execute format($f$
      create policy %1$I_select on public.%1$I for select to authenticated
        using (public.auth_has_permission('competition.read', public.revision_work_id(revision_id)));
      create policy %1$I_write on public.%1$I for all to authenticated
        using (public.auth_has_permission(%2$L, public.revision_work_id(revision_id)))
        with check (public.auth_has_permission(%2$L, public.revision_work_id(revision_id)));
    $f$, t, perm);
  end loop;
end $$;

create policy proposal_items_select on public.supplier_proposal_items for select to authenticated
  using (public.auth_has_permission('competition.read', public.revision_work_id(public.proposal_revision_id(proposal_id))));
create policy proposal_items_write on public.supplier_proposal_items for all to authenticated
  using (public.auth_has_permission('proposal.edit', public.revision_work_id(public.proposal_revision_id(proposal_id))))
  with check (public.auth_has_permission('proposal.edit', public.revision_work_id(public.proposal_revision_id(proposal_id))));

-- -----------------------------------------------------------------------------
-- Aprovações
-- -----------------------------------------------------------------------------
create policy approval_steps_select on public.approval_steps for select to authenticated using (true);
create policy approval_steps_admin on public.approval_steps for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

create policy approvals_select on public.approvals for select to authenticated
  using (public.auth_has_permission('competition.read', public.revision_work_id(revision_id)));
create policy approvals_insert on public.approvals for insert to authenticated
  with check (public.auth_has_permission('competition.submit', public.revision_work_id(revision_id)));
-- Só decide quem tem o papel da etapa (na obra ou global) + permissão approval.decide
create policy approvals_decide on public.approvals for update to authenticated
  using (status = 'pending'
         and public.auth_has_role(role_id, public.revision_work_id(revision_id))
         and public.auth_has_permission('approval.decide', public.revision_work_id(revision_id)))
  with check (public.auth_has_role(role_id, public.revision_work_id(revision_id)));

-- -----------------------------------------------------------------------------
-- Contratos e aditivos
-- -----------------------------------------------------------------------------
create policy contract_requests_select on public.contract_requests for select to authenticated
  using (public.auth_has_permission('contract.read', public.competition_work_id(competition_id)));
create policy contract_requests_write on public.contract_requests for all to authenticated
  using (public.auth_has_permission('contract.manage', public.competition_work_id(competition_id)))
  with check (public.auth_has_permission('contract.manage', public.competition_work_id(competition_id)));

create policy contract_request_items_select on public.contract_request_items for select to authenticated
  using (public.auth_has_permission('contract.read', public.contract_request_work_id(contract_request_id)));
create policy contract_request_items_write on public.contract_request_items for all to authenticated
  using (public.auth_has_permission('contract.manage', public.contract_request_work_id(contract_request_id)))
  with check (public.auth_has_permission('contract.manage', public.contract_request_work_id(contract_request_id)));

create policy contract_item_allocations_select on public.contract_item_allocations for select to authenticated
  using (public.auth_has_permission('contract.read', public.contract_request_work_id(
    (select contract_request_id from public.contract_request_items i where i.id = contract_request_item_id))));
create policy contract_item_allocations_write on public.contract_item_allocations for all to authenticated
  using (public.auth_has_permission('contract.manage', public.contract_request_work_id(
    (select contract_request_id from public.contract_request_items i where i.id = contract_request_item_id))))
  with check (public.auth_has_permission('contract.manage', public.contract_request_work_id(
    (select contract_request_id from public.contract_request_items i where i.id = contract_request_item_id))));

create policy contract_addenda_select on public.contract_addenda for select to authenticated
  using (public.auth_has_permission('contract.read', public.contract_request_work_id(contract_request_id)));
create policy contract_addenda_write on public.contract_addenda for all to authenticated
  using (public.auth_has_permission('contract.manage', public.contract_request_work_id(contract_request_id)))
  with check (public.auth_has_permission('contract.manage', public.contract_request_work_id(contract_request_id)));

create policy contract_addendum_items_select on public.contract_addendum_items for select to authenticated
  using (public.auth_has_permission('contract.read', public.addendum_work_id(addendum_id)));
create policy contract_addendum_items_write on public.contract_addendum_items for all to authenticated
  using (public.auth_has_permission('contract.manage', public.addendum_work_id(addendum_id)))
  with check (public.auth_has_permission('contract.manage', public.addendum_work_id(addendum_id)));

-- -----------------------------------------------------------------------------
-- Anexos, auditoria, integração
-- -----------------------------------------------------------------------------
create policy attachments_select on public.attachments for select to authenticated
  using (public.auth_can_access_work(work_id) and public.auth_has_permission('competition.read', work_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (public.auth_has_permission('attachment.upload', work_id) and uploaded_by = auth.uid());
create policy attachments_delete on public.attachments for delete to authenticated
  using (public.auth_is_admin());

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.auth_has_permission('audit.read', work_id));

create policy integration_logs_select on public.integration_logs for select to authenticated
  using (public.auth_has_permission('integration.read'));

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 007_storage.sql
-- =============================================================================
-- 007_storage.sql
-- Bucket privado para anexos (propostas, memoriais, aditivos, documentos de fornecedores)
-- Convenção de caminho: {work_id}/{entity_type}/{entity_id}/{uuid}-{nome-do-arquivo}
-- O banco guarda apenas metadados em public.attachments.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'qc-attachments', 'qc-attachments', false, 52428800,
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/zip',
    'text/csv'
  ]
)
on conflict (id) do nothing;

-- Primeiro segmento do caminho = work_id
create or replace function public.storage_work_id(p_name text)
returns uuid language plpgsql immutable
as $$
declare v text := split_part(p_name, '/', 1);
begin
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
end;
$$;

create policy qc_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'qc-attachments'
         and public.auth_can_access_work(public.storage_work_id(name))
         and public.auth_has_permission('competition.read', public.storage_work_id(name)));

create policy qc_attachments_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'qc-attachments'
              and public.auth_has_permission('attachment.upload', public.storage_work_id(name)));

create policy qc_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'qc-attachments' and public.auth_is_admin());

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 008_seed_reference_data.sql
-- =============================================================================
-- 008_seed_reference_data.sql
-- Dados de referência obrigatórios: papéis, permissões, fluxo de aprovação e
-- tipos de contrato (aba "Listas" do QC em Excel).
-- Idempotente (on conflict do nothing / do update).
-- =============================================================================

insert into public.roles (key, name, description) values
  ('admin',        'Administrador',                 'Acesso total, configurações e usuários'),
  ('procurement',  'Suprimentos',                   'Monta o QC, convida fornecedores e lança propostas'),
  ('engineering',  'Engenharia',                    'Define escopo, quantidades e valida tecnicamente'),
  ('manager',      'Gerente / Coordenador de Obra', 'Aprova o QC da obra'),
  ('director',     'Diretoria',                     'Aprova QCs acima da alçada'),
  ('viewer',       'Visualizador',                  'Somente leitura')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.permissions (key, description) values
  ('work.read',           'Ver obras'),
  ('work.manage',         'Cadastrar e editar obras'),
  ('budget.read',         'Ver orçamentos'),
  ('catalog.manage',      'Manter catálogo de insumos'),
  ('supplier.read',       'Ver fornecedores'),
  ('supplier.manage',     'Cadastrar e editar fornecedores'),
  ('competition.read',    'Ver quadros de concorrência'),
  ('competition.create',  'Criar quadros de concorrência'),
  ('competition.edit',    'Editar itens, fornecedores e revisões'),
  ('proposal.edit',       'Lançar e editar propostas'),
  ('competition.submit',  'Enviar revisão para aprovação'),
  ('approval.decide',     'Aprovar ou reprovar etapas'),
  ('contract.read',       'Ver solicitações de contrato e aditivos'),
  ('contract.manage',     'Gerar solicitações de contrato e aditivos'),
  ('attachment.upload',   'Enviar anexos'),
  ('audit.read',          'Consultar trilha de auditoria'),
  ('integration.read',    'Ver logs de integração'),
  ('integration.run',     'Disparar sincronização com ERP')
on conflict (key) do update set description = excluded.description;

with matrix(role_key, perm_key) as (
  values
  -- Administrador: tudo
  ('admin','work.read'),('admin','work.manage'),('admin','budget.read'),('admin','catalog.manage'),
  ('admin','supplier.read'),('admin','supplier.manage'),('admin','competition.read'),('admin','competition.create'),
  ('admin','competition.edit'),('admin','proposal.edit'),('admin','competition.submit'),('admin','approval.decide'),
  ('admin','contract.read'),('admin','contract.manage'),('admin','attachment.upload'),('admin','audit.read'),
  ('admin','integration.read'),('admin','integration.run'),
  -- Suprimentos
  ('procurement','work.read'),('procurement','budget.read'),('procurement','supplier.read'),('procurement','supplier.manage'),
  ('procurement','competition.read'),('procurement','competition.create'),('procurement','competition.edit'),
  ('procurement','proposal.edit'),('procurement','competition.submit'),('procurement','approval.decide'),
  ('procurement','contract.read'),('procurement','contract.manage'),('procurement','attachment.upload'),('procurement','audit.read'),
  -- Engenharia
  ('engineering','work.read'),('engineering','budget.read'),('engineering','supplier.read'),('engineering','competition.read'),
  ('engineering','competition.edit'),('engineering','approval.decide'),('engineering','contract.read'),('engineering','attachment.upload'),
  -- Gerente / Coordenador
  ('manager','work.read'),('manager','budget.read'),('manager','supplier.read'),('manager','competition.read'),
  ('manager','approval.decide'),('manager','contract.read'),('manager','audit.read'),
  -- Diretoria
  ('director','work.read'),('director','budget.read'),('director','supplier.read'),('director','competition.read'),
  ('director','approval.decide'),('director','contract.read'),('director','audit.read'),
  -- Visualizador
  ('viewer','work.read'),('viewer','budget.read'),('viewer','competition.read')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from matrix m
  join public.roles r on r.key = m.role_key
  join public.permissions p on p.key = m.perm_key
on conflict do nothing;

-- Fluxo padrão (ajustável em approval_steps)
insert into public.approval_steps (step_order, name, role_id, min_amount)
select v.step_order, v.name, r.id, v.min_amount
  from (values
    (1, 'Suprimentos',                    'procurement', null::numeric),
    (2, 'Engenharia',                     'engineering', null::numeric),
    (3, 'Gerente / Coordenador de Obra',  'manager',     null::numeric),
    (4, 'Diretoria',                      'director',    500000::numeric)
  ) as v(step_order, name, role_key, min_amount)
  join public.roles r on r.key = v.role_key
on conflict (step_order) do nothing;

-- Tipos de contrato (aba "Listas")
insert into public.contract_types (code, name, person_kind, jurisdiction, direct_billing) values
  ('CTD00', 'Minuta de Terceiros',                                                         null,   null, false),
  ('CTD01', 'Prestação de Serviços Engenharia PJ',                                          'cnpj', 'SP', false),
  ('CTD02', 'Empreitada Global Com Fornec. de Material - Sem Fat. Direto',                  'cnpj', 'SP', false),
  ('CTD03', 'Serviços de Elaboração de Imagens',                                            'cnpj', 'SP', false),
  ('CTD04', 'Empreitada Global Com Fornec. de Material - Com Fat. Direto',                  'cnpj', 'SP', true),
  ('CTD05', 'Empreitada Global Sem Fornec. de Material',                                    'cnpj', 'SP', false),
  ('CTD06', 'Locação, Manutenção e Operação de Equipamentos',                               'cnpj', 'SP', false),
  ('CTD07', 'Consultoria',                                                                  'cnpj', 'SP', false),
  ('CTD08', 'Empreitada de MDO Preço Unitário',                                             'cnpj', 'SP', false),
  ('CTD09', 'Elaboração de Projetos',                                                       'cnpj', 'SP', false),
  ('CTD10', 'Empreitada Preço Unitário Com Fornec. de Material - Com Fat. Direto',          'cnpj', 'SP', true),
  ('CTD11', 'Empreitada Global Com Fornec. de Material - Sem Fat. Direto',                  'cpf',  'BH', false),
  ('CTD12', 'Empreitada de MDO Preço Unitário',                                             'cnpj', 'BH', false),
  ('CTD13', 'Locação, Manutenção e Operação de Equipamentos',                               'cpf',  'BH', false),
  ('CTD14', 'Empreitada Global Sem Fornec. de Material',                                    'cpf',  'BH', false),
  ('CTD15', 'Elaboração de Projetos',                                                       'cpf',  'BH', false),
  ('CTD16', 'Elaboração de Projetos',                                                       'cnpj', 'BH', false),
  ('CTD17', 'Empreitada de MDO Preço Unitário',                                             'cpf',  'BH', false),
  ('CTD18', 'Prestação de Serviços Lafaete',                                                'cnpj', 'SP', false),
  ('CTD19', 'Aditivo Contrato - Prestador de Serviços PJ',                                  'cnpj', 'SP', false),
  ('CTD20', 'Prestador de Serviços PJ',                                                     'cnpj', 'SP', false),
  ('CTD21', 'Prestador de Serviços PJ',                                                     'cnpj', 'MG', false),
  ('CTD22', 'Aditivo Contrato - Prestador de Serviços PJ',                                  'cnpj', 'MG', false),
  ('CTD24', 'Distrato',                                                                     'cnpj', null, false),
  ('CTD25', 'Prestador de Serviços PJ - S/ VR',                                             'cnpj', 'SP', false)
on conflict (code) do update set name = excluded.name;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 009_read_models.sql
-- =============================================================================
-- 009_read_models.sql
-- Modelos de leitura (views/RPC) com SECURITY INVOKER — respeitam o RLS do usuário.
-- Valores numéricos são devolvidos como TEXT para preservar a precisão de numeric(18,4)
-- (o JSON do PostgREST seria lido como float no JavaScript).
-- =============================================================================

-- Pacotes de licitação (Vínculo PL) do orçamento
create or replace function public.qc_budget_packages(p_budget_id uuid)
returns table (package_code text, description text, total text, inputs integer)
language sql stable security invoker set search_path = public
as $$
  select ai.package_code,
         coalesce(max(ai.package_description), ai.package_code),
         sum(ai.total_cost)::numeric(18, 4)::text,
         count(*)::integer
    from public.activity_items ai
   where ai.budget_id = p_budget_id
     and ai.package_code is not null
   group by ai.package_code
   order by ai.package_code
$$;

-- Insumos agregados por material (quantidade somada; custo unitário médio ponderado)
create or replace function public.qc_aggregate_budget_inputs(
  p_budget_id uuid,
  p_package_code text default null,
  p_material_codes text[] default null
)
returns table (material_id uuid, code text, description text, unit text, quantity text, unit_cost text, total text)
language sql stable security invoker set search_path = public
as $$
  select m.id,
         m.code,
         m.description,
         m.unit,
         sum(ai.quantity)::numeric(18, 4)::text,
         case when sum(ai.quantity) = 0 then '0.0000'
              else round(sum(ai.total_cost) / sum(ai.quantity), 4)::numeric(18, 4)::text end,
         sum(ai.total_cost)::numeric(18, 4)::text
    from public.activity_items ai
    join public.materials m on m.id = ai.material_id
   where ai.budget_id = p_budget_id
     and (p_package_code is null or ai.package_code = p_package_code)
     and (p_material_codes is null or m.code = any (p_material_codes))
   group by m.id, m.code, m.description, m.unit
   order by m.code
$$;

-- Lista de concorrências com indicadores da revisão corrente
create or replace view public.qc_competition_list
with (security_invoker = true)
as
select c.id,
       c.code,
       c.title,
       c.work_id,
       w.code                      as work_code,
       w.name                      as work_name,
       c.status,
       c.package_code,
       c.requested_on,
       r.number                    as revision_number,
       r.status                    as revision_status,
       r.budget_amount::text       as budget_amount,
       (select sp.total_amount::text
          from public.competition_suppliers cs
          join public.supplier_proposals sp on sp.competition_supplier_id = cs.id
         where cs.revision_id = r.id and cs.supplier_id = r.winner_supplier_id)        as winner_total,
       (select sum(b.total_price)::numeric(18, 4)::text
          from public.best_conditions b where b.revision_id = r.id)                     as best_mix_total,
       (select count(*)::integer from public.competition_suppliers cs where cs.revision_id = r.id) as suppliers_count,
       greatest(c.updated_at, r.updated_at) as updated_at
  from public.competitions c
  join public.works w on w.id = c.work_id
  join public.competition_revisions r on r.id = c.current_revision_id;

-- Logs de auditoria de uma concorrência (todas as revisões), com nome do usuário
create or replace function public.qc_competition_audit(p_competition_id uuid, p_limit integer default 300)
returns table (
  id bigint, occurred_at timestamptz, user_id uuid, user_name text, entity text, entity_id uuid,
  action public.audit_action, field text, old_value jsonb, new_value jsonb, revision_id uuid,
  origin text, correlation_id text)
language sql stable security invoker set search_path = public
as $$
  select l.id, l.occurred_at, l.user_id, p.full_name, l.entity, l.entity_id, l.action, l.field,
         l.old_value, l.new_value, l.revision_id, l.origin, l.correlation_id
    from public.audit_logs l
    left join public.profiles p on p.id = l.user_id
   where l.entity_id = p_competition_id
      or l.revision_id in (select r.id from public.competition_revisions r where r.competition_id = p_competition_id)
   order by l.occurred_at desc, l.id desc
   limit greatest(1, least(p_limit, 1000))
$$;

grant execute on function public.qc_budget_packages(uuid) to authenticated;
grant execute on function public.qc_aggregate_budget_inputs(uuid, text, text[]) to authenticated;
grant execute on function public.qc_competition_audit(uuid, integer) to authenticated;
grant select on public.qc_competition_list to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 010_planning_links.sql
-- =============================================================================
-- 010_planning_links.sql
-- Vínculos de planejamento por item do QC e consumo do orçamento da obra.
--
-- Cada item do QC é amarrado a uma ou mais linhas (insumo do orçamento × vínculo de
-- planejamento / "Vínculo PL") com a quantidade correspondente — equivalente às
-- colunas "Vínculos" da Solic. Contrato e à aba "Análise IPs" da planilha.
-- O valor contratado de cada vínculo (awarded_*) é calculado pelo domínio
-- (preço da vencedora ou melhor condição × quantidade vinculada) e congela com a revisão.
-- =============================================================================

-- Valor contratado/estimado da revisão (vencedora, ou melhor condição por item)
alter table public.competition_revisions add column awarded_total public.money4;

create table public.competition_item_links (
  id                   uuid primary key default gen_random_uuid(),
  revision_id          uuid not null references public.competition_revisions (id) on delete cascade,
  competition_item_id  uuid not null references public.competition_items (id) on delete cascade,
  material_id          uuid not null references public.materials (id),        -- insumo do orçamento
  package_code         text not null,                                         -- vínculo de planejamento (IP)
  package_description  text,
  quantity             public.qty4 not null check (quantity >= 0),
  budget_unit_cost     public.money4 not null default 0,                      -- custo orçado do insumo no vínculo
  budget_total         public.money4 generated always as (round(quantity * budget_unit_cost, 4)) stored,
  awarded_unit_price   public.money4,
  awarded_total        public.money4,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (competition_item_id, material_id, package_code)
);
create index competition_item_links_revision_idx on public.competition_item_links (revision_id);
create index competition_item_links_package_idx on public.competition_item_links (package_code);

create trigger competition_item_links_set_updated_at before update on public.competition_item_links
  for each row execute function public.set_updated_at();
create trigger competition_item_links_guard_frozen before insert or update or delete on public.competition_item_links
  for each row execute function public.guard_frozen_revision_child();
create trigger competition_item_links_audit after insert or update or delete on public.competition_item_links
  for each row execute function public.audit_row_changes();

-- O vínculo deve pertencer à mesma revisão do item
create or replace function public.check_link_revision()
returns trigger language plpgsql
as $$
begin
  if not exists (select 1 from public.competition_items i where i.id = new.competition_item_id and i.revision_id = new.revision_id) then
    raise exception 'QC_LINK_REVISION_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger competition_item_links_check_revision before insert or update on public.competition_item_links
  for each row execute function public.check_link_revision();

alter table public.competition_item_links enable row level security;
create policy competition_item_links_select on public.competition_item_links for select to authenticated
  using (public.auth_has_permission('competition.read', public.revision_work_id(revision_id)));
create policy competition_item_links_write on public.competition_item_links for all to authenticated
  using (public.auth_has_permission('competition.edit', public.revision_work_id(revision_id)))
  with check (public.auth_has_permission('competition.edit', public.revision_work_id(revision_id)));

-- -----------------------------------------------------------------------------
-- Auditoria: ignora colunas derivadas
-- -----------------------------------------------------------------------------
create or replace function public.audit_row_changes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old       jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new       jsonb := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) end;
  v_row       jsonb := coalesce(v_new, v_old);
  v_actor     uuid := public.audit_actor_id();
  v_origin    text := coalesce(public.audit_request_header('x-audit-origin'),
                               case when current_setting('request.headers', true) is null then 'system' else 'api' end);
  v_corr      text := public.audit_request_header('x-correlation-id');
  v_revision  uuid;
  v_work      uuid;
  v_key       text;
  -- Valores derivados (recalculados pelo domínio) não geram trilha campo a campo
  v_ignored   text[] := array['updated_at', 'updated_by', 'created_at', 'awarded_total', 'awarded_unit_price', 'total_price', 'total_amount'];
begin
  -- revisão ativa
  v_revision := coalesce(
    (v_row ->> 'revision_id')::uuid,
    case when tg_table_name = 'competition_revisions' then (v_row ->> 'id')::uuid end,
    case when tg_table_name = 'supplier_proposal_items' then public.proposal_revision_id((v_row ->> 'proposal_id')::uuid) end,
    nullif(public.audit_request_header('x-revision-id'), '')::uuid
  );

  -- obra (para filtro de RLS)
  v_work := coalesce(
    (v_row ->> 'work_id')::uuid,
    case when tg_table_name = 'competition_revisions' then public.competition_work_id((v_row ->> 'competition_id')::uuid) end,
    case when v_revision is not null then public.revision_work_id(v_revision) end,
    case when tg_table_name = 'contract_requests' then public.competition_work_id((v_row ->> 'competition_id')::uuid) end,
    case when v_row ? 'contract_request_id' then public.contract_request_work_id((v_row ->> 'contract_request_id')::uuid) end,
    case when v_row ? 'addendum_id' then public.addendum_work_id((v_row ->> 'addendum_id')::uuid) end,
    case when tg_table_name = 'works' then (v_row ->> 'id')::uuid end
  );

  if tg_op = 'INSERT' then
    insert into public.audit_logs (user_id, entity, entity_id, action, field, old_value, new_value, revision_id, work_id, origin, correlation_id)
    values (v_actor, tg_table_name, (v_row ->> 'id')::uuid, 'insert', null, null, v_new, v_revision, v_work, v_origin, v_corr);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs (user_id, entity, entity_id, action, field, old_value, new_value, revision_id, work_id, origin, correlation_id)
    values (v_actor, tg_table_name, (v_row ->> 'id')::uuid, 'delete', null, v_old, null, v_revision, v_work, v_origin, v_corr);
    return old;
  end if;

  for v_key in select jsonb_object_keys(v_new)
  loop
    continue when v_key = any (v_ignored);
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.audit_logs (user_id, entity, entity_id, action, field, old_value, new_value, revision_id, work_id, origin, correlation_id)
      values (v_actor, tg_table_name, (v_row ->> 'id')::uuid, 'update', v_key, v_old -> v_key, v_new -> v_key,
              v_revision, v_work, v_origin, v_corr);
    end if;
  end loop;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Clonagem de revisão passa a copiar os vínculos
-- -----------------------------------------------------------------------------
create or replace function public.qc_clone_revision(p_revision_id uuid, p_reason text)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_src  public.competition_revisions;
  v_new  uuid := gen_random_uuid();
  v_next integer;
begin
  select * into v_src from public.competition_revisions where id = p_revision_id;
  if not found then
    raise exception 'QC_REVISION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(max(number), -1) + 1 into v_next
    from public.competition_revisions where competition_id = v_src.competition_id;

  insert into public.competition_revisions (
    id, competition_id, number, status, based_on_revision_id, reason,
    service_start_on, service_end_on, budget_amount, budget_used_amount, budget_adjustment_amount,
    engineering_notes, procurement_notes, contract_type_id, created_by)
  values (
    v_new, v_src.competition_id, v_next, 'draft', v_src.id, p_reason,
    v_src.service_start_on, v_src.service_end_on, v_src.budget_amount, v_src.budget_used_amount,
    v_src.budget_adjustment_amount, v_src.engineering_notes, v_src.procurement_notes,
    v_src.contract_type_id, auth.uid());

  create temporary table _item_map (old_id uuid, new_id uuid) on commit drop;
  insert into _item_map select id, gen_random_uuid() from public.competition_items where revision_id = v_src.id;

  insert into public.competition_items (
    id, revision_id, material_id, sort_order, code, description, unit, budget_quantity, budget_unit_cost,
    quantity, scope_description, contract_notes, pct_material, pct_equipment, pct_retention)
  select m.new_id, v_new, i.material_id, i.sort_order, i.code, i.description, i.unit, i.budget_quantity,
         i.budget_unit_cost, i.quantity, i.scope_description, i.contract_notes, i.pct_material,
         i.pct_equipment, i.pct_retention
    from public.competition_items i join _item_map m on m.old_id = i.id;

  create temporary table _sup_map (old_id uuid, new_id uuid) on commit drop;
  insert into _sup_map select id, gen_random_uuid() from public.competition_suppliers where revision_id = v_src.id;

  insert into public.competition_suppliers (
    id, revision_id, supplier_id, sort_order, status, legal_name, trade_name, tax_id, contact_name, phone,
    email, cnd_valid_until, delivery_terms, payment_terms, readjustment_terms, notes, strengths, weaknesses)
  select m.new_id, v_new, s.supplier_id, s.sort_order, s.status, s.legal_name, s.trade_name, s.tax_id,
         s.contact_name, s.phone, s.email, s.cnd_valid_until, s.delivery_terms, s.payment_terms,
         s.readjustment_terms, s.notes, s.strengths, s.weaknesses
    from public.competition_suppliers s join _sup_map m on m.old_id = s.id;

  create temporary table _prop_map (old_id uuid, new_id uuid) on commit drop;
  insert into _prop_map select id, gen_random_uuid() from public.supplier_proposals where revision_id = v_src.id;

  insert into public.supplier_proposals (
    id, revision_id, competition_supplier_id, proposal_ref, received_on, valid_until, total_amount, notes, created_by)
  select pm.new_id, v_new, sm.new_id, p.proposal_ref, p.received_on, p.valid_until, p.total_amount, p.notes, auth.uid()
    from public.supplier_proposals p
    join _prop_map pm on pm.old_id = p.id
    join _sup_map sm on sm.old_id = p.competition_supplier_id;

  insert into public.supplier_proposal_items (proposal_id, competition_item_id, unit_price, total_price, notes)
  select pm.new_id, im.new_id, pi.unit_price, pi.total_price, pi.notes
    from public.supplier_proposal_items pi
    join _prop_map pm on pm.old_id = pi.proposal_id
    join _item_map im on im.old_id = pi.competition_item_id;

  -- Vínculos de planejamento (insumo × vínculo PL) acompanham os itens
  insert into public.competition_item_links (
    revision_id, competition_item_id, material_id, package_code, package_description, quantity, budget_unit_cost,
    awarded_unit_price, awarded_total, sort_order)
  select v_new, im.new_id, l.material_id, l.package_code, l.package_description, l.quantity, l.budget_unit_cost,
         l.awarded_unit_price, l.awarded_total, l.sort_order
    from public.competition_item_links l
    join _item_map im on im.old_id = l.competition_item_id;

  update public.competition_revisions
     set awarded_total = (select awarded_total from public.competition_revisions where id = v_src.id)
   where id = v_new;

  update public.competitions set current_revision_id = v_new, status = 'open' where id = v_src.competition_id;

  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Modelos de leitura (SECURITY INVOKER — respeitam RLS; numéricos como texto)
-- -----------------------------------------------------------------------------

-- Insumos do orçamento por vínculo de planejamento (consolidador)
create or replace function public.qc_budget_inputs(p_budget_id uuid)
returns table (material_id uuid, code text, description text, unit text, package_code text,
               package_description text, quantity text, total text)
language sql stable security invoker set search_path = public
as $$
  select m.id, m.code, m.description, m.unit, ai.package_code,
         coalesce(max(ai.package_description), ai.package_code),
         sum(ai.quantity)::numeric(18, 4)::text,
         sum(ai.total_cost)::numeric(18, 4)::text
    from public.activity_items ai
    join public.materials m on m.id = ai.material_id
   where ai.budget_id = p_budget_id and ai.package_code is not null
   group by m.id, m.code, m.description, m.unit, ai.package_code
   order by ai.package_code, m.code
$$;

-- Revisão "efetiva" de cada concorrência: última aprovada; se não houver, a corrente.
create or replace function public.qc_effective_revisions(p_work_id uuid)
returns table (competition_id uuid, revision_id uuid, revision_number integer, category text, awarded_total text)
language sql stable security invoker set search_path = public
as $$
  with eff as (
    select c.id as competition_id,
           coalesce((select r.id from public.competition_revisions r
                      where r.competition_id = c.id and r.status in ('approved', 'superseded') and r.frozen_at is not null
                      order by (r.status = 'approved') desc, r.number desc limit 1),
                    c.current_revision_id) as revision_id
      from public.competitions c
     where c.work_id = p_work_id and c.status <> 'cancelled'
  )
  select e.competition_id, r.id, r.number,
         case when r.status in ('approved', 'superseded') then 'contracted'
              when r.status = 'in_approval' then 'in_approval'
              else 'quoting' end,
         coalesce(r.awarded_total, 0)::numeric(18, 4)::text
    from eff e join public.competition_revisions r on r.id = e.revision_id
$$;

-- Compromissos por vínculo/insumo das revisões efetivas da obra
create or replace function public.qc_work_link_commitments(p_work_id uuid)
returns table (competition_id uuid, revision_id uuid, category text, package_code text, material_id uuid,
               quantity text, amount text)
language sql stable security invoker set search_path = public
as $$
  select e.competition_id, e.revision_id, e.category, l.package_code, l.material_id,
         sum(l.quantity)::numeric(18, 4)::text,
         sum(coalesce(l.awarded_total, 0))::numeric(18, 4)::text
    from public.qc_effective_revisions(p_work_id) e
    join public.competition_item_links l on l.revision_id = e.revision_id
   group by e.competition_id, e.revision_id, e.category, l.package_code, l.material_id
$$;

grant execute on function public.qc_budget_inputs(uuid) to authenticated;
grant execute on function public.qc_effective_revisions(uuid) to authenticated;
grant execute on function public.qc_work_link_commitments(uuid) to authenticated;
grant select, insert, update, delete on public.competition_item_links to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 011_budget_lines.sql
-- =============================================================================
-- 011_budget_lines.sql
-- Orçamento linha a linha + importação via Excel + vários IPs por QC.
--
--  * Cada linha do orçamento (insumo de uma composição, com seu Vínculo PL) ganha uma chave
--    estável `line_key` = EAP da composição | código do insumo | IP [| ocorrência].
--    A chave permite reimportar o orçamento (nova versão) sem perder a rastreabilidade.
--  * O custo total da linha passa a ser valor armazenado (fonte: coluna "Custo Total" do Excel/ERP),
--    não mais calculado — evita divergência de arredondamento com o orçamento oficial.
--  * Vínculos dos itens do QC apontam para a linha do orçamento (activity_item_id + line_key).
--    Um QC pode reunir linhas de quantos IPs forem necessários.
-- =============================================================================

alter type public.record_source add value if not exists 'excel';

-- Linhas do orçamento ------------------------------------------------------------
alter table public.activity_items alter column total_cost drop expression;
alter table public.activity_items
  add column line_key   text,
  add column source_row integer;
update public.activity_items set line_key = id::text where line_key is null;
alter table public.activity_items alter column line_key set not null;
create unique index activity_items_line_key_idx on public.activity_items (budget_id, line_key);

-- Metadados de importação da versão do orçamento
alter table public.budgets
  add column import_file_name text,
  add column imported_at      timestamptz,
  add column imported_by      uuid references auth.users (id),
  add column lines_count      integer not null default 0;

-- Vínculos do QC por linha do orçamento --------------------------------------------
alter table public.competition_item_links
  add column activity_item_id uuid references public.activity_items (id) on delete restrict,
  add column line_key         text,
  alter column package_code drop not null;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.competition_item_links'::regclass and contype = 'u'
  loop
    execute format('alter table public.competition_item_links drop constraint %I', c.conname);
  end loop;
end $$;
create unique index competition_item_links_line_idx on public.competition_item_links (competition_item_id, line_key);
create index competition_item_links_line_key_idx on public.competition_item_links (line_key);

-- Permissão de importação ------------------------------------------------------------
insert into public.permissions (key, description) values ('budget.import', 'Importar orçamento (Excel) da obra')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
 where p.key = 'budget.import' and r.key in ('admin', 'procurement', 'engineering')
on conflict do nothing;

-- Clonagem de revisão copia a linha do orçamento vinculada -------------------------
create or replace function public.qc_clone_revision(p_revision_id uuid, p_reason text)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_src  public.competition_revisions;
  v_new  uuid := gen_random_uuid();
  v_next integer;
begin
  select * into v_src from public.competition_revisions where id = p_revision_id;
  if not found then
    raise exception 'QC_REVISION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(max(number), -1) + 1 into v_next
    from public.competition_revisions where competition_id = v_src.competition_id;

  insert into public.competition_revisions (
    id, competition_id, number, status, based_on_revision_id, reason,
    service_start_on, service_end_on, budget_amount, budget_used_amount, budget_adjustment_amount,
    engineering_notes, procurement_notes, contract_type_id, created_by)
  values (
    v_new, v_src.competition_id, v_next, 'draft', v_src.id, p_reason,
    v_src.service_start_on, v_src.service_end_on, v_src.budget_amount, v_src.budget_used_amount,
    v_src.budget_adjustment_amount, v_src.engineering_notes, v_src.procurement_notes,
    v_src.contract_type_id, auth.uid());

  create temporary table _item_map (old_id uuid, new_id uuid) on commit drop;
  insert into _item_map select id, gen_random_uuid() from public.competition_items where revision_id = v_src.id;

  insert into public.competition_items (
    id, revision_id, material_id, sort_order, code, description, unit, budget_quantity, budget_unit_cost,
    quantity, scope_description, contract_notes, pct_material, pct_equipment, pct_retention)
  select m.new_id, v_new, i.material_id, i.sort_order, i.code, i.description, i.unit, i.budget_quantity,
         i.budget_unit_cost, i.quantity, i.scope_description, i.contract_notes, i.pct_material,
         i.pct_equipment, i.pct_retention
    from public.competition_items i join _item_map m on m.old_id = i.id;

  create temporary table _sup_map (old_id uuid, new_id uuid) on commit drop;
  insert into _sup_map select id, gen_random_uuid() from public.competition_suppliers where revision_id = v_src.id;

  insert into public.competition_suppliers (
    id, revision_id, supplier_id, sort_order, status, legal_name, trade_name, tax_id, contact_name, phone,
    email, cnd_valid_until, delivery_terms, payment_terms, readjustment_terms, notes, strengths, weaknesses)
  select m.new_id, v_new, s.supplier_id, s.sort_order, s.status, s.legal_name, s.trade_name, s.tax_id,
         s.contact_name, s.phone, s.email, s.cnd_valid_until, s.delivery_terms, s.payment_terms,
         s.readjustment_terms, s.notes, s.strengths, s.weaknesses
    from public.competition_suppliers s join _sup_map m on m.old_id = s.id;

  create temporary table _prop_map (old_id uuid, new_id uuid) on commit drop;
  insert into _prop_map select id, gen_random_uuid() from public.supplier_proposals where revision_id = v_src.id;

  insert into public.supplier_proposals (
    id, revision_id, competition_supplier_id, proposal_ref, received_on, valid_until, total_amount, notes, created_by)
  select pm.new_id, v_new, sm.new_id, p.proposal_ref, p.received_on, p.valid_until, p.total_amount, p.notes, auth.uid()
    from public.supplier_proposals p
    join _prop_map pm on pm.old_id = p.id
    join _sup_map sm on sm.old_id = p.competition_supplier_id;

  insert into public.supplier_proposal_items (proposal_id, competition_item_id, unit_price, total_price, notes)
  select pm.new_id, im.new_id, pi.unit_price, pi.total_price, pi.notes
    from public.supplier_proposal_items pi
    join _prop_map pm on pm.old_id = pi.proposal_id
    join _item_map im on im.old_id = pi.competition_item_id;

  -- Vínculos de planejamento (insumo × vínculo PL) acompanham os itens
  insert into public.competition_item_links (
    revision_id, competition_item_id, material_id, package_code, package_description, quantity, budget_unit_cost,
    awarded_unit_price, awarded_total, sort_order, activity_item_id, line_key)
  select v_new, im.new_id, l.material_id, l.package_code, l.package_description, l.quantity, l.budget_unit_cost,
         l.awarded_unit_price, l.awarded_total, l.sort_order, l.activity_item_id, l.line_key
    from public.competition_item_links l
    join _item_map im on im.old_id = l.competition_item_id;

  update public.competition_revisions
     set awarded_total = (select awarded_total from public.competition_revisions where id = v_src.id)
   where id = v_new;

  update public.competitions set current_revision_id = v_new, status = 'open' where id = v_src.competition_id;

  return v_new;
end;
$$;

-- Leitura: linhas do orçamento ---------------------------------------------------------
create or replace function public.qc_budget_lines(p_budget_id uuid, p_packages text[] default null)
returns table (
  id uuid, line_key text, activity_wbs text, activity_code text, activity_description text,
  material_id uuid, code text, description text, unit text, package_code text, package_description text,
  quantity text, unit_cost text, total text, sort_order integer)
language sql stable security invoker set search_path = public
as $$
  select ai.id, ai.line_key, a.wbs_code, a.composition_code, a.description,
         m.id, m.code, m.description, m.unit, ai.package_code, ai.package_description,
         ai.quantity::text, ai.unit_cost::text, ai.total_cost::text, ai.sort_order
    from public.activity_items ai
    join public.activities a on a.id = ai.activity_id
    join public.materials m on m.id = ai.material_id
   where ai.budget_id = p_budget_id
     and (p_packages is null or ai.package_code = any (p_packages))
   order by ai.sort_order, a.wbs_code, m.code
$$;

-- Compromissos por linha do orçamento (revisões efetivas da obra)
drop function if exists public.qc_work_link_commitments(uuid);
create function public.qc_work_link_commitments(p_work_id uuid)
returns table (competition_id uuid, revision_id uuid, category text, package_code text, material_id uuid,
               line_key text, quantity text, amount text)
language sql stable security invoker set search_path = public
as $$
  select e.competition_id, e.revision_id, e.category, l.package_code, l.material_id, l.line_key,
         sum(l.quantity)::numeric(18, 4)::text,
         sum(coalesce(l.awarded_total, 0))::numeric(18, 4)::text
    from public.qc_effective_revisions(p_work_id) e
    join public.competition_item_links l on l.revision_id = e.revision_id
   group by e.competition_id, e.revision_id, e.category, l.package_code, l.material_id, l.line_key
$$;

-- Pacotes (IPs) com total pelo custo armazenado
create or replace function public.qc_budget_packages(p_budget_id uuid)
returns table (package_code text, description text, total text, inputs integer)
language sql stable security invoker set search_path = public
as $$
  select ai.package_code,
         coalesce(max(ai.package_description), ai.package_code),
         sum(ai.total_cost)::numeric(18, 4)::text,
         count(*)::integer
    from public.activity_items ai
   where ai.budget_id = p_budget_id and ai.package_code is not null
   group by ai.package_code
   order by ai.package_code
$$;

grant execute on function public.qc_budget_lines(uuid, text[]) to authenticated;
grant execute on function public.qc_work_link_commitments(uuid) to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 012_link_share.sql
-- =============================================================================
-- 012_link_share.sql
-- Percentual da linha do orçamento comprometido pelo QC ("puxar verba").
--
-- Cada vínculo item × linha do orçamento passa a registrar explicitamente:
--   budget_share = percentual da linha comprometido (0..1)
--   budget_value = verba puxada = custo total da linha × percentual
-- A quantidade vinculada continua armazenada (quantidade da linha × percentual).
-- =============================================================================

alter table public.competition_item_links
  add column budget_share public.ratio6,
  add column budget_value public.money4;

-- Backfill dos vínculos existentes a partir da quantidade.
-- É derivação estrutural (não altera quantidades nem valores já registrados) e também precisa
-- alcançar revisões aprovadas: os gatilhos de congelamento/auditoria/updated_at ficam suspensos
-- apenas durante o backfill, dentro da transação da migration. O snapshot congelado (JSON + hash)
-- das revisões aprovadas não é tocado.
alter table public.competition_item_links disable trigger competition_item_links_guard_frozen;
alter table public.competition_item_links disable trigger competition_item_links_audit;
alter table public.competition_item_links disable trigger competition_item_links_set_updated_at;

update public.competition_item_links l
   set budget_share = case when ai.quantity > 0 then least(1, round(l.quantity / ai.quantity, 6)) else 1 end,
       budget_value = case when ai.quantity > 0 then round(ai.total_cost * l.quantity / ai.quantity, 4) else ai.total_cost end
  from public.activity_items ai
 where ai.id = l.activity_item_id and l.budget_share is null;
update public.competition_item_links
   set budget_share = coalesce(budget_share, 1),
       budget_value = coalesce(budget_value, round(quantity * budget_unit_cost, 4));

alter table public.competition_item_links enable trigger competition_item_links_guard_frozen;
alter table public.competition_item_links enable trigger competition_item_links_audit;
alter table public.competition_item_links enable trigger competition_item_links_set_updated_at;

alter table public.competition_item_links
  alter column budget_share set not null,
  alter column budget_share set default 1,
  alter column budget_value set not null,
  alter column budget_value set default 0;

-- Clonagem copia percentual e verba
create or replace function public.qc_clone_revision(p_revision_id uuid, p_reason text)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_src  public.competition_revisions;
  v_new  uuid := gen_random_uuid();
  v_next integer;
begin
  select * into v_src from public.competition_revisions where id = p_revision_id;
  if not found then
    raise exception 'QC_REVISION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(max(number), -1) + 1 into v_next
    from public.competition_revisions where competition_id = v_src.competition_id;

  insert into public.competition_revisions (
    id, competition_id, number, status, based_on_revision_id, reason,
    service_start_on, service_end_on, budget_amount, budget_used_amount, budget_adjustment_amount,
    engineering_notes, procurement_notes, contract_type_id, created_by)
  values (
    v_new, v_src.competition_id, v_next, 'draft', v_src.id, p_reason,
    v_src.service_start_on, v_src.service_end_on, v_src.budget_amount, v_src.budget_used_amount,
    v_src.budget_adjustment_amount, v_src.engineering_notes, v_src.procurement_notes,
    v_src.contract_type_id, auth.uid());

  create temporary table _item_map (old_id uuid, new_id uuid) on commit drop;
  insert into _item_map select id, gen_random_uuid() from public.competition_items where revision_id = v_src.id;

  insert into public.competition_items (
    id, revision_id, material_id, sort_order, code, description, unit, budget_quantity, budget_unit_cost,
    quantity, scope_description, contract_notes, pct_material, pct_equipment, pct_retention)
  select m.new_id, v_new, i.material_id, i.sort_order, i.code, i.description, i.unit, i.budget_quantity,
         i.budget_unit_cost, i.quantity, i.scope_description, i.contract_notes, i.pct_material,
         i.pct_equipment, i.pct_retention
    from public.competition_items i join _item_map m on m.old_id = i.id;

  create temporary table _sup_map (old_id uuid, new_id uuid) on commit drop;
  insert into _sup_map select id, gen_random_uuid() from public.competition_suppliers where revision_id = v_src.id;

  insert into public.competition_suppliers (
    id, revision_id, supplier_id, sort_order, status, legal_name, trade_name, tax_id, contact_name, phone,
    email, cnd_valid_until, delivery_terms, payment_terms, readjustment_terms, notes, strengths, weaknesses)
  select m.new_id, v_new, s.supplier_id, s.sort_order, s.status, s.legal_name, s.trade_name, s.tax_id,
         s.contact_name, s.phone, s.email, s.cnd_valid_until, s.delivery_terms, s.payment_terms,
         s.readjustment_terms, s.notes, s.strengths, s.weaknesses
    from public.competition_suppliers s join _sup_map m on m.old_id = s.id;

  create temporary table _prop_map (old_id uuid, new_id uuid) on commit drop;
  insert into _prop_map select id, gen_random_uuid() from public.supplier_proposals where revision_id = v_src.id;

  insert into public.supplier_proposals (
    id, revision_id, competition_supplier_id, proposal_ref, received_on, valid_until, total_amount, notes, created_by)
  select pm.new_id, v_new, sm.new_id, p.proposal_ref, p.received_on, p.valid_until, p.total_amount, p.notes, auth.uid()
    from public.supplier_proposals p
    join _prop_map pm on pm.old_id = p.id
    join _sup_map sm on sm.old_id = p.competition_supplier_id;

  insert into public.supplier_proposal_items (proposal_id, competition_item_id, unit_price, total_price, notes)
  select pm.new_id, im.new_id, pi.unit_price, pi.total_price, pi.notes
    from public.supplier_proposal_items pi
    join _prop_map pm on pm.old_id = pi.proposal_id
    join _item_map im on im.old_id = pi.competition_item_id;

  -- Vínculos de planejamento (insumo × vínculo PL) acompanham os itens
  insert into public.competition_item_links (
    revision_id, competition_item_id, material_id, package_code, package_description, quantity, budget_unit_cost,
    awarded_unit_price, awarded_total, sort_order, activity_item_id, line_key, budget_share, budget_value)
  select v_new, im.new_id, l.material_id, l.package_code, l.package_description, l.quantity, l.budget_unit_cost,
         l.awarded_unit_price, l.awarded_total, l.sort_order, l.activity_item_id, l.line_key, l.budget_share, l.budget_value
    from public.competition_item_links l
    join _item_map im on im.old_id = l.competition_item_id;

  update public.competition_revisions
     set awarded_total = (select awarded_total from public.competition_revisions where id = v_src.id)
   where id = v_new;

  update public.competitions set current_revision_id = v_new, status = 'open' where id = v_src.competition_id;

  return v_new;
end;
$$;

-- Compromissos por linha incluem percentual e verba puxada
drop function if exists public.qc_work_link_commitments(uuid);
create function public.qc_work_link_commitments(p_work_id uuid)
returns table (competition_id uuid, revision_id uuid, category text, package_code text, material_id uuid,
               line_key text, quantity text, share text, budget_value text, amount text)
language sql stable security invoker set search_path = public
as $$
  select e.competition_id, e.revision_id, e.category, l.package_code, l.material_id, l.line_key,
         sum(l.quantity)::numeric(18, 4)::text,
         sum(l.budget_share)::numeric(12, 6)::text,
         sum(l.budget_value)::numeric(18, 4)::text,
         sum(coalesce(l.awarded_total, 0))::numeric(18, 4)::text
    from public.qc_effective_revisions(p_work_id) e
    join public.competition_item_links l on l.revision_id = e.revision_id
   group by e.competition_id, e.revision_id, e.category, l.package_code, l.material_id, l.line_key
$$;
grant execute on function public.qc_work_link_commitments(uuid) to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 013_contract_requests.sql
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

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 014_attachments.sql
-- =============================================================================
-- 014_attachments.sql
-- Upload de anexos (propostas, memoriais, planilhas do orçamento, documentos de contrato).
--
--  * O arquivo vai direto do navegador para o Storage (URL assinada gerada pela API) — o
--    binário não passa pela Vercel Function (limite de 4,5 MB por requisição).
--  * public.attachments guarda os metadados; o caminho continua
--    {work_id}/{entity_type}/{entity_id}/{uuid}-{arquivo}.
--  * Novas origens: 'work' (documentos gerais da obra) e 'budget' (planilha importada).
--  * Quem enviou pode remover o próprio anexo enquanto a revisão do QC não estiver congelada;
--    administradores removem qualquer um. Remoção de anexo fica na auditoria.
-- =============================================================================

alter table public.attachments drop constraint if exists attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check check (entity_type in (
  'work', 'budget', 'competition', 'competition_revision', 'supplier_proposal', 'supplier',
  'contract_request', 'contract_addendum'));

alter table public.attachments add column if not exists description text check (description is null or length(description) <= 500);
alter table public.attachments add column if not exists competition_supplier_id uuid references public.competition_suppliers (id) on delete set null;

create index if not exists attachments_work_idx on public.attachments (work_id, uploaded_at desc);

-- Anexo vinculado a uma revisão aprovada (congelada) não pode ser removido
create or replace function public.attachment_is_frozen(p_entity_type text, p_entity_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select case p_entity_type
    when 'competition_revision' then exists (select 1 from public.competition_revisions r where r.id = p_entity_id and r.frozen_at is not null)
    else false
  end
$$;

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments for delete to authenticated
  using (
    public.auth_is_admin()
    or (uploaded_by = auth.uid()
        and public.auth_has_permission('attachment.upload', work_id)
        and not public.attachment_is_frozen(entity_type, entity_id))
  );

-- Storage: quem enviou também pode apagar o binário (o metadado é apagado em seguida pela API)
drop policy if exists qc_attachments_delete on storage.objects;
create policy qc_attachments_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'qc-attachments'
    and (public.auth_is_admin()
         or exists (select 1 from public.attachments a
                     where a.storage_path = storage.objects.name
                       and a.uploaded_by = auth.uid()
                       and not public.attachment_is_frozen(a.entity_type, a.entity_id)))
  );

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 015_access_helpers.sql
-- =============================================================================
-- 015_access_helpers.sql
-- Dar e tirar acesso ao QC com uma linha no SQL Editor, sem procurar UUIDs:
--
--   select public.qc_conceder_acesso('fulano@unitaengenharia.com.br', 'admin');
--   select public.qc_conceder_acesso('fulano@unitaengenharia.com.br', 'procurement', '2041');  -- só a obra 2041
--   select public.qc_remover_acesso('fulano@unitaengenharia.com.br', 'procurement');            -- tira o papel (todas as obras)
--   select * from public.qc_acessos;                                                            -- quem tem o quê
--
-- Papéis: admin · procurement (Suprimentos) · engineering (Engenharia) ·
--         manager (Gerente/Coordenador) · director (Diretoria) · viewer (Visualizador)
--
-- Só o dono do banco (SQL Editor) e o service_role executam: o app e os usuários não
-- conseguem chamar estas funções para se dar papéis.
-- =============================================================================

create or replace function public.qc_conceder_acesso(p_email text, p_papel text default 'admin', p_obra text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_user  uuid;
  v_name  text;
  v_role  uuid;
  v_work  uuid;
begin
  select id, coalesce(raw_user_meta_data ->> 'full_name', '') into v_user, v_name
    from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'Usuário % não existe no Supabase Auth. Crie em Authentication → Users.', p_email;
  end if;

  select id into v_role from public.roles where key = lower(trim(p_papel));
  if v_role is null then
    raise exception 'Papel "%" não existe. Use: %.', p_papel, (select string_agg(key, ', ' order by key) from public.roles);
  end if;

  if p_obra is not null then
    select id into v_work from public.works where code = trim(p_obra);
    if v_work is null then raise exception 'Obra % não encontrada.', p_obra; end if;
  end if;

  -- Usuário criado antes do schema não passou pelo gatilho: cria (ou reativa) o perfil
  insert into public.profiles (id, full_name, email, active)
  values (v_user, v_name, lower(trim(p_email)), true)
  on conflict (id) do update set active = true, email = coalesce(public.profiles.email, excluded.email);

  insert into public.user_roles (user_id, role_id, work_id)
  values (v_user, v_role, v_work)
  on conflict do nothing;

  return format('%s agora tem o papel %s em %s.', p_email, lower(trim(p_papel)), coalesce('obra ' || p_obra, 'todas as obras'));
end;
$$;

create or replace function public.qc_remover_acesso(p_email text, p_papel text, p_obra text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.user_roles ur
   using auth.users u, public.roles r
   where ur.user_id = u.id and ur.role_id = r.id
     and lower(u.email) = lower(trim(p_email))
     and r.key = lower(trim(p_papel))
     and (ur.work_id is not distinct from (select id from public.works where code = trim(p_obra)));
  get diagnostics v_count = row_count;
  return case when v_count = 0 then 'Nada removido: o usuário não tinha esse papel.' else format('Papel %s removido de %s.', p_papel, p_email) end;
end;
$$;

revoke all on function public.qc_conceder_acesso(text, text, text) from public, anon, authenticated;
revoke all on function public.qc_remover_acesso(text, text, text) from public, anon, authenticated;

-- Quem tem acesso a quê (só para consulta no SQL Editor)
create or replace view public.qc_acessos as
select p.email, p.full_name as nome, p.active as ativo, r.key as papel, r.name as papel_nome,
       coalesce(w.code || ' — ' || w.name, 'todas as obras') as obra
  from public.profiles p
  left join public.user_roles ur on ur.user_id = p.id
  left join public.roles r on r.id = ur.role_id
  left join public.works w on w.id = ur.work_id
 order by p.email, r.key;

revoke all on public.qc_acessos from public, anon, authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 016_addendum_kind_allocations.sql
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

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 017_budget_sheet.sql
-- =============================================================================
-- 017_budget_sheet.sql
-- Orçamento das obras vindo da aba "BD_Orcamentos" (Excel no SharePoint, lido pelo Microsoft Graph).
--
--   * works: chave da obra na UAU (empresa + obra, as mesmas colunas Empresa_pla e Obra_pla da
--     planilha) e o nº do orçamento escolhido (NumOrca_pla).
--   * activity_items: composição auxiliar aberta — cada insumo da auxiliar é uma linha e guarda
--     de qual auxiliar veio (código, descrição, unidade, coeficiente no serviço e custo unitário).
--   * Origem 'sharepoint' para versões de orçamento importadas da planilha.
--   * qc_budget_lines passa a devolver também a composição auxiliar de cada linha.
-- =============================================================================

alter type public.record_source add value if not exists 'sharepoint';

alter table public.works
  add column if not exists uau_company_code  text,
  add column if not exists uau_work_code     text,
  add column if not exists uau_budget_number text;

create unique index if not exists works_uau_key_idx on public.works (uau_company_code, uau_work_code)
  where uau_company_code is not null and uau_work_code is not null;

alter table public.activity_items
  add column if not exists aux_code        text,
  add column if not exists aux_description text,
  add column if not exists aux_unit        text,
  add column if not exists aux_coefficient numeric(18, 8),
  add column if not exists aux_unit_cost   public.money4;

-- Leitura das linhas do orçamento com a composição auxiliar (o retorno muda: recria a função)
drop function if exists public.qc_budget_lines(uuid, text[]);
create function public.qc_budget_lines(p_budget_id uuid, p_packages text[] default null)
returns table (
  id uuid, line_key text, activity_wbs text, activity_code text, activity_description text,
  material_id uuid, code text, description text, unit text, package_code text, package_description text,
  quantity text, unit_cost text, total text, sort_order integer,
  aux_code text, aux_description text, aux_unit text, aux_coefficient text, aux_unit_cost text)
language sql stable security invoker set search_path = public
as $$
  select ai.id, ai.line_key, a.wbs_code, a.composition_code, a.description,
         m.id, m.code, m.description, m.unit, ai.package_code, ai.package_description,
         ai.quantity::text, ai.unit_cost::text, ai.total_cost::text, ai.sort_order,
         ai.aux_code, ai.aux_description, ai.aux_unit, ai.aux_coefficient::text, ai.aux_unit_cost::text
    from public.activity_items ai
    join public.activities a on a.id = ai.activity_id
    join public.materials m on m.id = ai.material_id
   where ai.budget_id = p_budget_id
     and (p_packages is null or ai.package_code = any (p_packages))
   order by ai.sort_order, a.wbs_code, m.code
$$;

grant execute on function public.qc_budget_lines(uuid, text[]) to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 018_qc_reference_items.sql
-- =============================================================================
-- 018_qc_reference_items.sql
-- Insumos do mapa (reais, de contrato) × insumos referência (do orçamento).
--
--   * competition_references: insumos do orçamento puxados pelo QC. As linhas do orçamento
--     (competition_item_links, com IP e % de cada linha) passam a pertencer à referência.
--   * competition_item_references: ligação N:N insumo do mapa ↔ referência (comparação com o orçado).
--   * competition_items: origem (preenchido pela referência ou criado no mapa) e IP manual.
--   * Migração: cada item existente vira também uma referência com as mesmas linhas, ligada 1:1.
--   * budget_line_planning: IP escolhido à mão por linha do orçamento (pela chave da linha);
--     vale para as próximas versões importadas.
--   * suppliers.is_placeholder + fornecedor "Sem Fornecedor" (quadros internos).
--   * contract_request_items.references: insumos referência usados no QC (para a solicitação).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Insumos referência
-- -----------------------------------------------------------------------------
create table public.competition_references (
  id           uuid primary key default gen_random_uuid(),
  revision_id  uuid not null references public.competition_revisions (id) on delete cascade,
  material_id  uuid not null references public.materials (id),
  sort_order   integer not null default 0,
  code         text not null,
  description  text not null,
  unit         text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index competition_references_revision_idx on public.competition_references (revision_id);

create trigger competition_references_set_updated_at before update on public.competition_references
  for each row execute function public.set_updated_at();
create trigger competition_references_guard_frozen before insert or update or delete on public.competition_references
  for each row execute function public.guard_frozen_revision_child();
create trigger competition_references_audit after insert or update or delete on public.competition_references
  for each row execute function public.audit_row_changes();

alter table public.competition_references enable row level security;
create policy competition_references_select on public.competition_references for select to authenticated
  using (public.auth_has_permission('competition.read', public.revision_work_id(revision_id)));
create policy competition_references_write on public.competition_references for all to authenticated
  using (public.auth_has_permission('competition.edit', public.revision_work_id(revision_id)))
  with check (public.auth_has_permission('competition.edit', public.revision_work_id(revision_id)));

-- Ligação insumo do mapa ↔ referência
create table public.competition_item_references (
  revision_id          uuid not null references public.competition_revisions (id) on delete cascade,
  competition_item_id  uuid not null references public.competition_items (id) on delete cascade,
  reference_id         uuid not null references public.competition_references (id) on delete cascade,
  created_at           timestamptz not null default now(),
  primary key (competition_item_id, reference_id)
);
create index competition_item_references_revision_idx on public.competition_item_references (revision_id);
create index competition_item_references_reference_idx on public.competition_item_references (reference_id);

create trigger competition_item_references_guard_frozen before insert or update or delete on public.competition_item_references
  for each row execute function public.guard_frozen_revision_child();

alter table public.competition_item_references enable row level security;
create policy competition_item_references_select on public.competition_item_references for select to authenticated
  using (public.auth_has_permission('competition.read', public.revision_work_id(revision_id)));
create policy competition_item_references_write on public.competition_item_references for all to authenticated
  using (public.auth_has_permission('competition.edit', public.revision_work_id(revision_id)))
  with check (public.auth_has_permission('competition.edit', public.revision_work_id(revision_id)));

-- Item e referência da ligação são da mesma revisão
create or replace function public.check_item_reference_revision()
returns trigger language plpgsql
as $$
begin
  if not exists (select 1 from public.competition_items i where i.id = new.competition_item_id and i.revision_id = new.revision_id)
     or not exists (select 1 from public.competition_references r where r.id = new.reference_id and r.revision_id = new.revision_id) then
    raise exception 'QC_REFERENCE_REVISION_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger competition_item_references_check_revision before insert or update on public.competition_item_references
  for each row execute function public.check_item_reference_revision();

-- -----------------------------------------------------------------------------
-- Insumos do mapa: origem e IP manual
-- -----------------------------------------------------------------------------
alter table public.competition_items
  add column if not exists origin text not null default 'reference' check (origin in ('reference', 'manual')),
  add column if not exists planning_code text,
  add column if not exists planning_description text;

-- -----------------------------------------------------------------------------
-- Linhas do orçamento passam a pertencer à referência
-- -----------------------------------------------------------------------------
alter table public.competition_item_links
  add column if not exists reference_id uuid references public.competition_references (id) on delete cascade;

-- O vínculo pertence à mesma revisão da referência
create or replace function public.check_link_revision()
returns trigger language plpgsql
as $$
begin
  if not exists (select 1 from public.competition_references r where r.id = new.reference_id and r.revision_id = new.revision_id) then
    raise exception 'QC_LINK_REVISION_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Migração dos QCs existentes (inclusive revisões congeladas: os dados não mudam, só a estrutura)
alter table public.competition_item_links disable trigger competition_item_links_guard_frozen;
alter table public.competition_item_links disable trigger competition_item_links_audit;
alter table public.competition_item_links disable trigger competition_item_links_set_updated_at;
alter table public.competition_references disable trigger competition_references_guard_frozen;
alter table public.competition_references disable trigger competition_references_audit;
alter table public.competition_item_references disable trigger competition_item_references_guard_frozen;

create temporary table _ref_map on commit drop as
  select i.id as item_id, gen_random_uuid() as reference_id, i.revision_id, i.material_id, i.sort_order, i.code, i.description, i.unit
    from public.competition_items i
   where i.material_id is not null
     and exists (select 1 from public.competition_item_links l where l.competition_item_id = i.id);

insert into public.competition_references (id, revision_id, material_id, sort_order, code, description, unit)
select reference_id, revision_id, material_id, sort_order, code, description, unit from _ref_map;

insert into public.competition_item_references (revision_id, competition_item_id, reference_id)
select revision_id, item_id, reference_id from _ref_map;

update public.competition_item_links l
   set reference_id = m.reference_id
  from _ref_map m
 where m.item_id = l.competition_item_id;

-- A linha deixa de apontar para o item (senão apagar o item apagaria as linhas da referência)
alter table public.competition_item_links alter column competition_item_id drop not null;
update public.competition_item_links set competition_item_id = null where competition_item_id is not null;
-- Vínculos órfãos (item sem insumo) não existem mais no modelo
delete from public.competition_item_links where reference_id is null;

alter table public.competition_item_links enable trigger competition_item_links_guard_frozen;
alter table public.competition_item_links enable trigger competition_item_links_audit;
alter table public.competition_item_links enable trigger competition_item_links_set_updated_at;
alter table public.competition_references enable trigger competition_references_guard_frozen;
alter table public.competition_references enable trigger competition_references_audit;
alter table public.competition_item_references enable trigger competition_item_references_guard_frozen;

alter table public.competition_item_links alter column reference_id set not null;
drop index if exists public.competition_item_links_line_idx;
create unique index competition_item_links_reference_line_idx on public.competition_item_links (reference_id, line_key);
create index competition_item_links_reference_idx on public.competition_item_links (reference_id);

-- -----------------------------------------------------------------------------
-- Nova revisão: copia também referências, linhas e ligações
-- -----------------------------------------------------------------------------
create or replace function public.qc_clone_revision(p_revision_id uuid, p_reason text)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_src  public.competition_revisions;
  v_new  uuid := gen_random_uuid();
  v_next integer;
begin
  select * into v_src from public.competition_revisions where id = p_revision_id;
  if not found then
    raise exception 'QC_REVISION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(max(number), -1) + 1 into v_next
    from public.competition_revisions where competition_id = v_src.competition_id;

  insert into public.competition_revisions (
    id, competition_id, number, status, based_on_revision_id, reason,
    service_start_on, service_end_on, budget_amount, budget_used_amount, budget_adjustment_amount,
    engineering_notes, procurement_notes, contract_type_id, created_by)
  values (
    v_new, v_src.competition_id, v_next, 'draft', v_src.id, p_reason,
    v_src.service_start_on, v_src.service_end_on, v_src.budget_amount, v_src.budget_used_amount,
    v_src.budget_adjustment_amount, v_src.engineering_notes, v_src.procurement_notes,
    v_src.contract_type_id, auth.uid());

  create temporary table _item_map (old_id uuid, new_id uuid) on commit drop;
  insert into _item_map select id, gen_random_uuid() from public.competition_items where revision_id = v_src.id;

  insert into public.competition_items (
    id, revision_id, material_id, sort_order, code, description, unit, budget_quantity, budget_unit_cost,
    quantity, scope_description, contract_notes, pct_material, pct_equipment, pct_retention,
    origin, planning_code, planning_description)
  select m.new_id, v_new, i.material_id, i.sort_order, i.code, i.description, i.unit, i.budget_quantity,
         i.budget_unit_cost, i.quantity, i.scope_description, i.contract_notes, i.pct_material,
         i.pct_equipment, i.pct_retention, i.origin, i.planning_code, i.planning_description
    from public.competition_items i join _item_map m on m.old_id = i.id;

  create temporary table _ref_map (old_id uuid, new_id uuid) on commit drop;
  insert into _ref_map select id, gen_random_uuid() from public.competition_references where revision_id = v_src.id;

  insert into public.competition_references (id, revision_id, material_id, sort_order, code, description, unit)
  select m.new_id, v_new, r.material_id, r.sort_order, r.code, r.description, r.unit
    from public.competition_references r join _ref_map m on m.old_id = r.id;

  insert into public.competition_item_references (revision_id, competition_item_id, reference_id)
  select v_new, im.new_id, rm.new_id
    from public.competition_item_references x
    join _item_map im on im.old_id = x.competition_item_id
    join _ref_map rm on rm.old_id = x.reference_id;

  create temporary table _sup_map (old_id uuid, new_id uuid) on commit drop;
  insert into _sup_map select id, gen_random_uuid() from public.competition_suppliers where revision_id = v_src.id;

  insert into public.competition_suppliers (
    id, revision_id, supplier_id, sort_order, status, legal_name, trade_name, tax_id, contact_name, phone,
    email, cnd_valid_until, delivery_terms, payment_terms, readjustment_terms, notes, strengths, weaknesses)
  select m.new_id, v_new, s.supplier_id, s.sort_order, s.status, s.legal_name, s.trade_name, s.tax_id,
         s.contact_name, s.phone, s.email, s.cnd_valid_until, s.delivery_terms, s.payment_terms,
         s.readjustment_terms, s.notes, s.strengths, s.weaknesses
    from public.competition_suppliers s join _sup_map m on m.old_id = s.id;

  create temporary table _prop_map (old_id uuid, new_id uuid) on commit drop;
  insert into _prop_map select id, gen_random_uuid() from public.supplier_proposals where revision_id = v_src.id;

  insert into public.supplier_proposals (
    id, revision_id, competition_supplier_id, proposal_ref, received_on, valid_until, total_amount, notes, created_by)
  select pm.new_id, v_new, sm.new_id, p.proposal_ref, p.received_on, p.valid_until, p.total_amount, p.notes, auth.uid()
    from public.supplier_proposals p
    join _prop_map pm on pm.old_id = p.id
    join _sup_map sm on sm.old_id = p.competition_supplier_id;

  insert into public.supplier_proposal_items (proposal_id, competition_item_id, unit_price, total_price, notes)
  select pm.new_id, im.new_id, pi.unit_price, pi.total_price, pi.notes
    from public.supplier_proposal_items pi
    join _prop_map pm on pm.old_id = pi.proposal_id
    join _item_map im on im.old_id = pi.competition_item_id;

  -- Linhas do orçamento acompanham as referências
  insert into public.competition_item_links (
    revision_id, reference_id, material_id, package_code, package_description, quantity, budget_unit_cost,
    awarded_unit_price, awarded_total, sort_order, activity_item_id, line_key, budget_share, budget_value)
  select v_new, rm.new_id, l.material_id, l.package_code, l.package_description, l.quantity, l.budget_unit_cost,
         l.awarded_unit_price, l.awarded_total, l.sort_order, l.activity_item_id, l.line_key, l.budget_share, l.budget_value
    from public.competition_item_links l
    join _ref_map rm on rm.old_id = l.reference_id;

  update public.competition_revisions
     set awarded_total = (select awarded_total from public.competition_revisions where id = v_src.id)
   where id = v_new;

  update public.competitions set current_revision_id = v_new, status = 'open' where id = v_src.competition_id;

  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- IP escolhido à mão por linha do orçamento
-- -----------------------------------------------------------------------------
create table public.budget_line_planning (
  work_id              uuid not null references public.works (id) on delete cascade,
  line_key             text not null,
  package_code         text not null,
  package_description  text,
  updated_by           uuid default auth.uid(),
  updated_at           timestamptz not null default now(),
  primary key (work_id, line_key)
);

alter table public.budget_line_planning enable row level security;
create policy budget_line_planning_select on public.budget_line_planning for select to authenticated
  using (public.auth_has_permission('budget.read', work_id));
create policy budget_line_planning_write on public.budget_line_planning for all to authenticated
  using (public.auth_has_permission('budget.import', work_id))
  with check (public.auth_has_permission('budget.import', work_id));

-- IP da planilha guardado quando a linha recebe IP manual (para poder voltar)
alter table public.activity_items
  add column if not exists package_manual boolean not null default false,
  add column if not exists original_package_code text,
  add column if not exists original_package_description text;

-- -----------------------------------------------------------------------------
-- Fornecedor "Sem Fornecedor" (quadros internos): fora da sincronização com o ERP
-- -----------------------------------------------------------------------------
-- CNPJ fictício só de zeros (o QC copia o CNPJ do fornecedor; a tela não o mostra para o "Sem Fornecedor")
alter table public.suppliers add column if not exists is_placeholder boolean not null default false;
create unique index if not exists suppliers_single_placeholder_idx on public.suppliers (is_placeholder) where is_placeholder;

insert into public.suppliers (legal_name, trade_name, tax_id, active, is_placeholder)
select 'Sem Fornecedor', 'Sem Fornecedor', '00000000000000', true, true
 where not exists (select 1 from public.suppliers where is_placeholder or tax_id = '00000000000000');
update public.suppliers set is_placeholder = true, active = true where tax_id = '00000000000000';

-- -----------------------------------------------------------------------------
-- Solicitação de contrato: insumos referência de cada item
-- -----------------------------------------------------------------------------
alter table public.contract_request_items
  add column if not exists "references" jsonb not null default '[]'::jsonb;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 019_line_planning_on_read.sql
-- =============================================================================
-- 019_line_planning_on_read.sql
-- IP manual das linhas do orçamento resolvido na leitura.
--
--   * qc_budget_lines devolve o IP manual (budget_line_planning) no lugar do IP da planilha e
--     marca a linha (package_manual). As versões do orçamento não são mais regravadas.
--   * Saem as colunas de cópia criadas na 018 (activity_items.package_manual / original_*).
--   * Sai competition_item_links.competition_item_id: desde a 018 a linha pertence à referência.
-- Idempotente: pode rodar depois da 018 já aplicada.
-- =============================================================================

-- Linhas que receberam IP manual pela cópia da 018 voltam ao IP da planilha (o manual segue em budget_line_planning)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activity_items' and column_name = 'package_manual') then
    execute 'update public.activity_items
                set package_code = original_package_code, package_description = original_package_description
              where package_manual';
  end if;
end $$;

alter table public.activity_items
  drop column if exists package_manual,
  drop column if exists original_package_code,
  drop column if exists original_package_description;

alter table public.competition_item_links drop column if exists competition_item_id;

drop function if exists public.qc_budget_lines(uuid, text[]);
create function public.qc_budget_lines(p_budget_id uuid, p_packages text[] default null)
returns table (
  id uuid, line_key text, activity_wbs text, activity_code text, activity_description text,
  material_id uuid, code text, description text, unit text, package_code text, package_description text,
  package_manual boolean, quantity text, unit_cost text, total text, sort_order integer,
  aux_code text, aux_description text, aux_unit text, aux_coefficient text, aux_unit_cost text)
language sql stable security invoker set search_path = public
as $$
  select ai.id, ai.line_key, a.wbs_code, a.composition_code, a.description,
         m.id, m.code, m.description, m.unit,
         coalesce(p.package_code, ai.package_code),
         case when p.package_code is not null then p.package_description else ai.package_description end,
         p.package_code is not null,
         ai.quantity::text, ai.unit_cost::text, ai.total_cost::text, ai.sort_order,
         ai.aux_code, ai.aux_description, ai.aux_unit, ai.aux_coefficient::text, ai.aux_unit_cost::text
    from public.activity_items ai
    join public.budgets b on b.id = ai.budget_id
    join public.activities a on a.id = ai.activity_id
    join public.materials m on m.id = ai.material_id
    left join public.budget_line_planning p on p.work_id = b.work_id and p.line_key = ai.line_key
   where ai.budget_id = p_budget_id
     and (p_packages is null or coalesce(p.package_code, ai.package_code) = any (p_packages))
   order by ai.sort_order, a.wbs_code, m.code
$$;

grant execute on function public.qc_budget_lines(uuid, text[]) to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 020_budget_group_names.sql
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

-- Registro das migrations aplicadas (para o Supabase CLI não reaplicar com db push)
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values
  ('001', 'initial_schema'),
  ('002', 'rbac'),
  ('003', 'competitions'),
  ('004', 'approvals_contracts'),
  ('005', 'audit'),
  ('006', 'rls'),
  ('007', 'storage'),
  ('008', 'seed_reference_data'),
  ('009', 'read_models'),
  ('010', 'planning_links'),
  ('011', 'budget_lines'),
  ('012', 'link_share'),
  ('013', 'contract_requests'),
  ('014', 'attachments'),
  ('015', 'access_helpers'),
  ('016', 'addendum_kind_allocations'),
  ('017', 'budget_sheet'),
  ('018', 'qc_reference_items'),
  ('019', 'line_planning_on_read'),
  ('020', 'budget_group_names')
on conflict (version) do nothing;

commit;
