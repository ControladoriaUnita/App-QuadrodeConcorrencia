-- =============================================================================
-- 006_rls.sql
-- Row Level Security em TODAS as tabelas.
--
-- Princípios
--   * Leitura: usuário precisa ter acesso à obra (papel global ou na obra) + permissão de leitura.
--   * Escrita: permissão específica, avaliada no escopo da obra.
--   * Dados do ERP (orçamentos, atividades, insumos) só são escritos pela API com service_role,
--     que ignora RLS — o client nunca tem essa chave.
--   * audit_logs: inserção só via trigger (SECURITY DEFINER); leitura com audit.read.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'works','materials','budgets','budget_items','activities','activity_items','suppliers','contract_types',
    'profiles','roles','permissions','role_permissions','user_roles',
    'competitions','competition_revisions','competition_items','competition_suppliers',
    'supplier_proposals','supplier_proposal_items','best_conditions',
    'approval_steps','approvals','contract_requests','contract_request_items','contract_item_allocations',
    'contract_addenda','contract_addendum_items','attachments','audit_logs','integration_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Observação: não usamos FORCE RLS — as funções SECURITY DEFINER (helpers de autorização e
-- trigger de auditoria) pertencem ao owner das tabelas e precisam ler/escrever sem recursão de RLS.
-- Nenhuma política de INSERT existe em audit_logs: clientes não conseguem escrever diretamente.

-- -----------------------------------------------------------------------------
-- RBAC
-- -----------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid() or public.auth_is_admin())
  with check (id = auth.uid() or public.auth_is_admin());

create policy roles_select on public.roles for select to authenticated using (true);
create policy roles_admin on public.roles for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

create policy permissions_select on public.permissions for select to authenticated using (true);
create policy permissions_admin on public.permissions for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
create policy role_permissions_admin on public.role_permissions for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.auth_is_admin());
create policy user_roles_admin on public.user_roles for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

-- -----------------------------------------------------------------------------
-- Cadastros
-- -----------------------------------------------------------------------------
create policy works_select on public.works for select to authenticated
  using (public.auth_can_access_work(id) and public.auth_has_permission('work.read', id));
create policy works_insert on public.works for insert to authenticated
  with check (public.auth_has_permission('work.manage'));
create policy works_update on public.works for update to authenticated
  using (public.auth_has_permission('work.manage', id)) with check (public.auth_has_permission('work.manage', id));

create policy materials_select on public.materials for select to authenticated using (true);
create policy materials_write on public.materials for all to authenticated
  using (public.auth_has_permission('catalog.manage')) with check (public.auth_has_permission('catalog.manage'));

create policy suppliers_select on public.suppliers for select to authenticated
  using (public.auth_has_permission('supplier.read'));
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.auth_has_permission('supplier.manage')) with check (public.auth_has_permission('supplier.manage'));

create policy contract_types_select on public.contract_types for select to authenticated using (true);
create policy contract_types_write on public.contract_types for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

-- Orçamento: somente leitura para usuários (escrita via service_role / ERP)
create policy budgets_select on public.budgets for select to authenticated
  using (public.auth_has_permission('budget.read', work_id));
create policy budget_items_select on public.budget_items for select to authenticated
  using (public.auth_has_permission('budget.read', public.budget_work_id(budget_id)));
create policy activities_select on public.activities for select to authenticated
  using (public.auth_has_permission('budget.read', public.budget_work_id(budget_id)));
create policy activity_items_select on public.activity_items for select to authenticated
  using (public.auth_has_permission('budget.read', public.budget_work_id(budget_id)));

-- -----------------------------------------------------------------------------
-- Concorrências
-- -----------------------------------------------------------------------------
create policy competitions_select on public.competitions for select to authenticated
  using (public.auth_has_permission('competition.read', work_id));
create policy competitions_insert on public.competitions for insert to authenticated
  with check (public.auth_has_permission('competition.create', work_id));
-- approval.decide também atualiza (status/revisão corrente ao concluir o fluxo de aprovação)
create policy competitions_update on public.competitions for update to authenticated
  using (public.auth_has_permission('competition.edit', work_id) or public.auth_has_permission('approval.decide', work_id))
  with check (public.auth_has_permission('competition.edit', work_id) or public.auth_has_permission('approval.decide', work_id));

create policy revisions_select on public.competition_revisions for select to authenticated
  using (public.auth_has_permission('competition.read', public.competition_work_id(competition_id)));
create policy revisions_insert on public.competition_revisions for insert to authenticated
  with check (public.auth_has_permission('competition.edit', public.competition_work_id(competition_id)));
create policy revisions_update on public.competition_revisions for update to authenticated
  using (public.auth_has_permission('competition.edit', public.competition_work_id(competition_id))
         or public.auth_has_permission('approval.decide', public.competition_work_id(competition_id)))
  with check (public.auth_has_permission('competition.edit', public.competition_work_id(competition_id))
         or public.auth_has_permission('approval.decide', public.competition_work_id(competition_id)));

-- Filhos da revisão
do $$
declare
  t text;
  perm text;
begin
  for t, perm in select * from (values
      ('competition_items', 'competition.edit'),
      ('competition_suppliers', 'competition.edit'),
      ('supplier_proposals', 'proposal.edit'),
      ('best_conditions', 'competition.edit')) as v(t, perm)
  loop
    execute format($f$
      create policy %1$I_select on public.%1$I for select to authenticated
        using (public.auth_has_permission('competition.read', public.revision_work_id(revision_id)));
      create policy %1$I_write on public.%1$I for all to authenticated
        using (public.auth_has_permission(%2$L, public.revision_work_id(revision_id)))
        with check (public.auth_has_permission(%2$L, public.revision_work_id(revision_id)));
    $f$, t, perm);
  end loop;
end $$;

create policy proposal_items_select on public.supplier_proposal_items for select to authenticated
  using (public.auth_has_permission('competition.read', public.revision_work_id(public.proposal_revision_id(proposal_id))));
create policy proposal_items_write on public.supplier_proposal_items for all to authenticated
  using (public.auth_has_permission('proposal.edit', public.revision_work_id(public.proposal_revision_id(proposal_id))))
  with check (public.auth_has_permission('proposal.edit', public.revision_work_id(public.proposal_revision_id(proposal_id))));

-- -----------------------------------------------------------------------------
-- Aprovações
-- -----------------------------------------------------------------------------
create policy approval_steps_select on public.approval_steps for select to authenticated using (true);
create policy approval_steps_admin on public.approval_steps for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

create policy approvals_select on public.approvals for select to authenticated
  using (public.auth_has_permission('competition.read', public.revision_work_id(revision_id)));
create policy approvals_insert on public.approvals for insert to authenticated
  with check (public.auth_has_permission('competition.submit', public.revision_work_id(revision_id)));
-- Só decide quem tem o papel da etapa (na obra ou global) + permissão approval.decide
create policy approvals_decide on public.approvals for update to authenticated
  using (status = 'pending'
         and public.auth_has_role(role_id, public.revision_work_id(revision_id))
         and public.auth_has_permission('approval.decide', public.revision_work_id(revision_id)))
  with check (public.auth_has_role(role_id, public.revision_work_id(revision_id)));

-- -----------------------------------------------------------------------------
-- Contratos e aditivos
-- -----------------------------------------------------------------------------
create policy contract_requests_select on public.contract_requests for select to authenticated
  using (public.auth_has_permission('contract.read', public.competition_work_id(competition_id)));
create policy contract_requests_write on public.contract_requests for all to authenticated
  using (public.auth_has_permission('contract.manage', public.competition_work_id(competition_id)))
  with check (public.auth_has_permission('contract.manage', public.competition_work_id(competition_id)));

create policy contract_request_items_select on public.contract_request_items for select to authenticated
  using (public.auth_has_permission('contract.read', public.contract_request_work_id(contract_request_id)));
create policy contract_request_items_write on public.contract_request_items for all to authenticated
  using (public.auth_has_permission('contract.manage', public.contract_request_work_id(contract_request_id)))
  with check (public.auth_has_permission('contract.manage', public.contract_request_work_id(contract_request_id)));

create policy contract_item_allocations_select on public.contract_item_allocations for select to authenticated
  using (public.auth_has_permission('contract.read', public.contract_request_work_id(
    (select contract_request_id from public.contract_request_items i where i.id = contract_request_item_id))));
create policy contract_item_allocations_write on public.contract_item_allocations for all to authenticated
  using (public.auth_has_permission('contract.manage', public.contract_request_work_id(
    (select contract_request_id from public.contract_request_items i where i.id = contract_request_item_id))))
  with check (public.auth_has_permission('contract.manage', public.contract_request_work_id(
    (select contract_request_id from public.contract_request_items i where i.id = contract_request_item_id))));

create policy contract_addenda_select on public.contract_addenda for select to authenticated
  using (public.auth_has_permission('contract.read', public.contract_request_work_id(contract_request_id)));
create policy contract_addenda_write on public.contract_addenda for all to authenticated
  using (public.auth_has_permission('contract.manage', public.contract_request_work_id(contract_request_id)))
  with check (public.auth_has_permission('contract.manage', public.contract_request_work_id(contract_request_id)));

create policy contract_addendum_items_select on public.contract_addendum_items for select to authenticated
  using (public.auth_has_permission('contract.read', public.addendum_work_id(addendum_id)));
create policy contract_addendum_items_write on public.contract_addendum_items for all to authenticated
  using (public.auth_has_permission('contract.manage', public.addendum_work_id(addendum_id)))
  with check (public.auth_has_permission('contract.manage', public.addendum_work_id(addendum_id)));

-- -----------------------------------------------------------------------------
-- Anexos, auditoria, integração
-- -----------------------------------------------------------------------------
create policy attachments_select on public.attachments for select to authenticated
  using (public.auth_can_access_work(work_id) and public.auth_has_permission('competition.read', work_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (public.auth_has_permission('attachment.upload', work_id) and uploaded_by = auth.uid());
create policy attachments_delete on public.attachments for delete to authenticated
  using (public.auth_is_admin());

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.auth_has_permission('audit.read', work_id));

create policy integration_logs_select on public.integration_logs for select to authenticated
  using (public.auth_has_permission('integration.read'));
