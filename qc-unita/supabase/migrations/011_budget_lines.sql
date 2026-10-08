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
