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
