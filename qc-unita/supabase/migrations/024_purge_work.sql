-- =============================================================================
-- 024_purge_work.sql
-- Exclusão definitiva de obra (administrador) e limpeza das concorrências para o simulado.
--
--   * qc_purge_work(obra, autor, manter_obra):
--       - manter_obra = false: apaga a obra inteira (orçamentos, concorrências, contratos, aditivos,
--         anexos, de-para da obra, nomes dos Itens, indireto e papéis por obra);
--       - manter_obra = true: apaga só concorrências, contratos, aditivos e anexos (a obra e o
--         orçamento ficam; usado antes de gerar o simulado).
--     As travas (revisão congelada, contrato enviado, aditivo decidido) existem para o uso normal;
--     aqui elas são suspensas só dentro desta transação (disable trigger user: as chaves
--     estrangeiras e os cascades continuam valendo). Sem auditoria linha a linha: fica um registro
--     único da exclusão em audit_logs, que não é apagado.
--   * Só o servidor chama (service_role), depois de conferir que o usuário é administrador global.
-- =============================================================================

create or replace function public.qc_purge_work(p_work_id uuid, p_actor uuid, p_keep_work boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_competitions integer;
  v_contracts integer;
  v_tables text[] := array[
    'works', 'budgets', 'budget_items', 'activities', 'activity_items',
    'competitions', 'competition_revisions', 'competition_items', 'competition_suppliers',
    'supplier_proposals', 'supplier_proposal_items', 'best_conditions', 'approvals',
    'competition_item_links', 'competition_references', 'competition_item_references',
    'contract_requests', 'contract_request_items', 'contract_item_allocations',
    'contract_addenda', 'contract_addendum_items', 'contract_addendum_item_allocations',
    'attachments', 'user_roles', 'budget_line_planning', 'budget_group_names', 'work_indirect_costs'];
  t text;
begin
  select code into v_code from public.works where id = p_work_id;
  if v_code is null then
    raise exception 'QC_WORK_NOT_FOUND: obra % não encontrada', p_work_id;
  end if;

  select count(*) into v_competitions from public.competitions where work_id = p_work_id;
  select count(*) into v_contracts
    from public.contract_requests cr join public.competitions c on c.id = cr.competition_id
   where c.work_id = p_work_id;

  -- Registro único (antes de suspender as travas, que incluem a auditoria linha a linha)
  insert into public.audit_logs (user_id, entity, entity_id, action, old_value, work_id, origin)
  values (p_actor, case when p_keep_work then 'competitions' else 'works' end, p_work_id, 'delete',
          jsonb_build_object('work_code', v_code, 'keep_work', p_keep_work,
                             'competitions', v_competitions, 'contracts', v_contracts),
          p_work_id, 'ui');

  foreach t in array v_tables loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  -- Aditivos seguram o contrato (on delete restrict); o contrato segura a concorrência
  delete from public.contract_addenda a
   using public.contract_requests cr, public.competitions c
   where a.contract_request_id = cr.id and cr.competition_id = c.id and c.work_id = p_work_id;
  delete from public.contract_requests cr
   using public.competitions c
   where cr.competition_id = c.id and c.work_id = p_work_id;
  -- Revisões, mapa, propostas, aprovações e vínculos saem em cascata com a concorrência
  delete from public.competitions where work_id = p_work_id;
  delete from public.attachments where work_id = p_work_id;

  if not p_keep_work then
    -- Vínculo antigo de outra obra apontando para linha desta (on delete restrict): fica só a chave
    update public.competition_item_links l set activity_item_id = null
      from public.activity_items ai join public.budgets b on b.id = ai.budget_id
     where l.activity_item_id = ai.id and b.work_id = p_work_id;
    delete from public.budgets where work_id = p_work_id;
    delete from public.works where id = p_work_id;
  end if;

  -- A revisão corrente da concorrência é uma chave adiada (deferrable): a checagem pendente das
  -- linhas apagadas impediria reativar as travas ("pending trigger events"). Roda agora.
  set constraints all immediate;
  foreach t in array v_tables loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  return jsonb_build_object('competitions', v_competitions, 'contracts', v_contracts);
end;
$$;

revoke all on function public.qc_purge_work(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.qc_purge_work(uuid, uuid, boolean) to service_role;
