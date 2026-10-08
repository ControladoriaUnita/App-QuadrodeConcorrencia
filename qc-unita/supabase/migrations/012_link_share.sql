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
