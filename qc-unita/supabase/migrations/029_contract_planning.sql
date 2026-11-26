-- =============================================================================
-- 029_contract_planning.sql
-- Solicitação de contrato dentro do QC: vínculos de planejamento editáveis pelo Planejamento.
--
--   * Papel novo "Planejamento" (planning) e permissão contract.planning: editar os vínculos
--     (IP · Qtd) dos itens da solicitação, também depois do envio do QC e com o contrato
--     concluído. Administrador também recebe a permissão.
--   * contract_item_allocations: escrita liberada para contract.manage OU contract.planning.
--   * Trava da solicitação: os vínculos podem mudar em rascunho e em contrato concluído
--     (submitted / sent_to_erp / signed); cancelado continua travado. Itens continuam só em rascunho.
-- Idempotente.
-- =============================================================================

insert into public.roles (key, name, description) values
  ('planning', 'Planejamento', 'Vincula os itens dos contratos aos IPs de planejamento')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.permissions (key, description) values
  ('contract.planning', 'Editar os vínculos de planejamento (IP) dos itens do contrato')
on conflict (key) do update set description = excluded.description;

with matrix(role_key, perm_key) as (
  values
  ('planning','work.read'),('planning','budget.read'),('planning','supplier.read'),('planning','competition.read'),
  ('planning','contract.read'),('planning','contract.planning'),
  ('admin','contract.planning')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from matrix m
  join public.roles r on r.key = m.role_key
  join public.permissions p on p.key = m.perm_key
on conflict do nothing;

-- RLS dos vínculos --------------------------------------------------------------------
drop policy if exists contract_item_allocations_write on public.contract_item_allocations;
create policy contract_item_allocations_write on public.contract_item_allocations for all to authenticated
  using (
    public.auth_has_permission('contract.manage', public.contract_request_work_id(
      (select contract_request_id from public.contract_request_items i where i.id = contract_request_item_id)))
    or public.auth_has_permission('contract.planning', public.contract_request_work_id(
      (select contract_request_id from public.contract_request_items i where i.id = contract_request_item_id))))
  with check (
    public.auth_has_permission('contract.manage', public.contract_request_work_id(
      (select contract_request_id from public.contract_request_items i where i.id = contract_request_item_id)))
    or public.auth_has_permission('contract.planning', public.contract_request_work_id(
      (select contract_request_id from public.contract_request_items i where i.id = contract_request_item_id))));

-- Trava: vínculos também em contrato concluído ------------------------------------------
create or replace function public.guard_contract_request_child()
returns trigger language plpgsql
as $$
declare
  v_request uuid;
  v_status  public.contract_request_status;
begin
  if tg_table_name = 'contract_item_allocations' then
    select i.contract_request_id into v_request from public.contract_request_items i
     where i.id = coalesce(new.contract_request_item_id, old.contract_request_item_id);
  elsif tg_op = 'DELETE' then
    v_request := old.contract_request_id;
  else
    v_request := new.contract_request_id;
  end if;
  select status into v_status from public.contract_requests where id = v_request;
  if tg_table_name = 'contract_item_allocations' then
    if v_status is not null and v_status = 'cancelled' then
      raise exception 'CONTRACT_LOCKED: vínculos de solicitação cancelada não podem ser alterados' using errcode = 'P0001';
    end if;
  elsif v_status is not null and v_status <> 'draft' then
    raise exception 'CONTRACT_LOCKED: itens da solicitação não podem ser alterados fora do rascunho' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
