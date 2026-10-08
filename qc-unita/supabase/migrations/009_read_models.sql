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
