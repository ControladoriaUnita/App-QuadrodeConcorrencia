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
