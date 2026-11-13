-- =============================================================================
-- 027_qc_out_of_scope.sql
-- Fora de escopo ligado ao QC.
--
--   * competition_items.out_of_scope_quantity: quantidade do insumo do mapa que não está no
--     orçamento, informada à mão; null = automática (insumo sem referência é 100% fora de escopo).
--     Unitário, totais e desvio por linha são calculados (shared/domain/competition/scope.ts).
--   * qc_clone_revision copia a coluna para a nova revisão.
--   * out_of_scope_costs.competition_id: QC a que a solicitação manual se refere (opcional).
-- =============================================================================

alter table public.competition_items
  add column if not exists out_of_scope_quantity public.qty4 check (out_of_scope_quantity is null or out_of_scope_quantity >= 0);

alter table public.out_of_scope_costs
  add column if not exists competition_id uuid references public.competitions (id) on delete set null;
create index if not exists out_of_scope_costs_competition_idx on public.out_of_scope_costs (competition_id) where competition_id is not null;

-- A solicitação só aponta QC da mesma obra
create or replace function public.out_of_scope_check_competition()
returns trigger language plpgsql
as $$
begin
  if new.competition_id is not null
     and not exists (select 1 from public.competitions c where c.id = new.competition_id and c.work_id = new.work_id) then
    raise exception 'OUT_OF_SCOPE_COMPETITION: a concorrência não é desta obra' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists out_of_scope_costs_competition on public.out_of_scope_costs;
create trigger out_of_scope_costs_competition before insert or update of competition_id, work_id on public.out_of_scope_costs
  for each row execute function public.out_of_scope_check_competition();

-- Nova revisão copia a quantidade fora de escopo de cada insumo
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
    origin, planning_code, planning_description, out_of_scope_quantity)
  select m.new_id, v_new, i.material_id, i.sort_order, i.code, i.description, i.unit, i.budget_quantity,
         i.budget_unit_cost, i.quantity, i.scope_description, i.contract_notes, i.pct_material,
         i.pct_equipment, i.pct_retention, i.origin, i.planning_code, i.planning_description, i.out_of_scope_quantity
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
