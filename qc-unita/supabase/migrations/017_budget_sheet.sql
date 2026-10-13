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
