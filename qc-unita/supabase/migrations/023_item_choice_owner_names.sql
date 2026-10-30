-- =============================================================================
-- 023_item_choice_owner_names.sql
-- Cotação escolhida e responsáveis por extenso.
--
--   * competition_items.chosen_supplier_id: fornecedor escolhido à mão para contratar cada insumo
--     do mapa (permite mais de uma empresa vencedora na mesma concorrência). Não altera a
--     melhor condição nem a vencedora indicada; forma o cenário "Cotação escolhida".
--   * competitions.engineering_owner_name / procurement_owner_name: engenheiro e suprimentos
--     responsáveis digitados (deixam de ser escolhidos numa lista de usuários). Os existentes
--     recebem o nome do usuário que estava indicado.
--   * qc_clone_revision passa a copiar a escolha para a nova revisão.
--   * contract_requests: uma solicitação ativa por concorrência E empresa (a cotação escolhida gera
--     uma solicitação para cada empresa escolhida).
-- =============================================================================

alter table public.competition_items
  add column if not exists chosen_supplier_id uuid references public.competition_suppliers (id) on delete set null;

-- Insumo e fornecedor escolhido são da mesma revisão
create or replace function public.check_item_chosen_supplier_revision()
returns trigger language plpgsql
as $$
begin
  if new.chosen_supplier_id is not null
     and not exists (select 1 from public.competition_suppliers s where s.id = new.chosen_supplier_id and s.revision_id = new.revision_id) then
    raise exception 'QC_CHOSEN_SUPPLIER_REVISION_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists competition_items_check_chosen_supplier on public.competition_items;
create trigger competition_items_check_chosen_supplier before insert or update of chosen_supplier_id on public.competition_items
  for each row execute function public.check_item_chosen_supplier_revision();

alter table public.competitions
  add column if not exists engineering_owner_name text,
  add column if not exists procurement_owner_name text;

update public.competitions c set engineering_owner_name = p.full_name
  from public.profiles p where p.id = c.engineering_owner_id and c.engineering_owner_name is null;
update public.competitions c set procurement_owner_name = p.full_name
  from public.profiles p where p.id = c.procurement_owner_id and c.procurement_owner_name is null;

-- -----------------------------------------------------------------------------
-- Nova revisão: a escolha de cada insumo acompanha o fornecedor copiado
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

  update public.competition_items ni
     set chosen_supplier_id = sm.new_id
    from _item_map im
    join public.competition_items oi on oi.id = im.old_id
    join _sup_map sm on sm.old_id = oi.chosen_supplier_id
   where ni.id = im.new_id;

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
-- Cotação escolhida → uma solicitação de contrato por empresa escolhida
-- -----------------------------------------------------------------------------
-- Antes: uma solicitação não cancelada por concorrência. Agora: uma por concorrência e empresa.
drop index if exists public.contract_requests_one_active;
create unique index if not exists contract_requests_one_active_supplier
  on public.contract_requests (competition_id, supplier_id) where status <> 'cancelled';
