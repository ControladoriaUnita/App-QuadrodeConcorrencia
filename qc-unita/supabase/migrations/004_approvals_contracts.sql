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
