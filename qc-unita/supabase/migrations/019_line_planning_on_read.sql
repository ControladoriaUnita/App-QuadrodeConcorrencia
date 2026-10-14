-- =============================================================================
-- 019_line_planning_on_read.sql
-- IP manual das linhas do orçamento resolvido na leitura.
--
--   * qc_budget_lines devolve o IP manual (budget_line_planning) no lugar do IP da planilha e
--     marca a linha (package_manual). As versões do orçamento não são mais regravadas.
--   * Saem as colunas de cópia criadas na 018 (activity_items.package_manual / original_*).
--   * Sai competition_item_links.competition_item_id: desde a 018 a linha pertence à referência.
-- Idempotente: pode rodar depois da 018 já aplicada.
-- =============================================================================

-- Linhas que receberam IP manual pela cópia da 018 voltam ao IP da planilha (o manual segue em budget_line_planning)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activity_items' and column_name = 'package_manual') then
    execute 'update public.activity_items
                set package_code = original_package_code, package_description = original_package_description
              where package_manual';
  end if;
end $$;

alter table public.activity_items
  drop column if exists package_manual,
  drop column if exists original_package_code,
  drop column if exists original_package_description;

alter table public.competition_item_links drop column if exists competition_item_id;

drop function if exists public.qc_budget_lines(uuid, text[]);
create function public.qc_budget_lines(p_budget_id uuid, p_packages text[] default null)
returns table (
  id uuid, line_key text, activity_wbs text, activity_code text, activity_description text,
  material_id uuid, code text, description text, unit text, package_code text, package_description text,
  package_manual boolean, quantity text, unit_cost text, total text, sort_order integer,
  aux_code text, aux_description text, aux_unit text, aux_coefficient text, aux_unit_cost text)
language sql stable security invoker set search_path = public
as $$
  select ai.id, ai.line_key, a.wbs_code, a.composition_code, a.description,
         m.id, m.code, m.description, m.unit,
         coalesce(p.package_code, ai.package_code),
         case when p.package_code is not null then p.package_description else ai.package_description end,
         p.package_code is not null,
         ai.quantity::text, ai.unit_cost::text, ai.total_cost::text, ai.sort_order,
         ai.aux_code, ai.aux_description, ai.aux_unit, ai.aux_coefficient::text, ai.aux_unit_cost::text
    from public.activity_items ai
    join public.budgets b on b.id = ai.budget_id
    join public.activities a on a.id = ai.activity_id
    join public.materials m on m.id = ai.material_id
    left join public.budget_line_planning p on p.work_id = b.work_id and p.line_key = ai.line_key
   where ai.budget_id = p_budget_id
     and (p_packages is null or coalesce(p.package_code, ai.package_code) = any (p_packages))
   order by ai.sort_order, a.wbs_code, m.code
$$;

grant execute on function public.qc_budget_lines(uuid, text[]) to authenticated;
