-- =============================================================================
-- Quadro de Concorrência · Unità Engenharia — migrations 016, 017 e 018 juntas
-- Para um banco que já tem o schema até a 015 (qc_unita_schema_completo.sql antigo).
--
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Roda numa única transação: se algo falhar, nada fica pela metade.
--   016 · aditivos e distratos item a item, com vínculo de IP por item
--   017 · obra pela UAU e orçamento da planilha do SharePoint
--   018 · insumos do mapa × insumos referência, IP manual no orçamento, "Sem Fornecedor"
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.works') is null then
    raise exception 'Este banco ainda não tem o schema do QC. Rode supabase/setup/qc_unita_schema_completo.sql (completo) em vez deste.';
  end if;
  if to_regtype('public.addendum_kind') is not null then
    raise exception 'A migration 016 já foi aplicada neste banco. Rode só as que faltam (017 e/ou 018) pelos arquivos de supabase/migrations.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'works' and column_name = 'uau_company_code') then
    raise exception 'A migration 017 já foi aplicada neste banco. Rode só a 018 (supabase/migrations/018_qc_reference_items.sql).';
  end if;
  if to_regclass('public.competition_references') is not null then
    raise exception 'A migration 018 já foi aplicada neste banco. Nada a fazer.';
  end if;
end $$;

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

commit;
