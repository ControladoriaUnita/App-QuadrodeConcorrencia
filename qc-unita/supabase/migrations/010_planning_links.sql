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
