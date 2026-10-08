-- =============================================================================
-- 005_audit.sql
-- Auditoria obrigatória (campo a campo) e logs de integração ERP
--
-- Contexto da auditoria — propagado pela API via headers do PostgREST:
--   x-audit-origin   : ui | api | erp_sync | system | migration
--   x-correlation-id : id da requisição (rastreio ponta a ponta)
--   x-revision-id    : revisão ativa no momento da alteração (opcional)
--   x-actor-id       : usuário real quando a chamada usa service_role
--                      (aceito SOMENTE se o JWT for service_role)
-- =============================================================================

create type public.audit_action as enum ('insert', 'update', 'delete');
create type public.integration_status as enum ('started', 'success', 'partial', 'error');

create table public.audit_logs (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  user_id         uuid,                                 -- quem
  entity          text not null,                        -- tabela
  entity_id       uuid,
  action          public.audit_action not null,
  field           text,                                 -- campo (NULL em insert/delete = linha inteira)
  old_value       jsonb,
  new_value       jsonb,
  revision_id     uuid,                                 -- revisão ativa
  work_id         uuid,
  origin          text not null default 'system',       -- origem da alteração
  correlation_id  text
);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id, occurred_at desc);
create index audit_logs_revision_idx on public.audit_logs (revision_id, occurred_at desc) where revision_id is not null;
create index audit_logs_user_idx on public.audit_logs (user_id, occurred_at desc);

create table public.integration_logs (
  id                 uuid primary key default gen_random_uuid(),
  correlation_id     text not null,
  provider           text not null,                    -- mock | uau | senior
  operation          text not null,                    -- getWorks, syncBudget ...
  direction          text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  integration_id     text,                             -- id externo da entidade/lote
  status             public.integration_status not null default 'started',
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  records_processed  integer not null default 0,
  records_failed     integer not null default 0,
  message            text,
  error_detail       jsonb,
  payload_summary    jsonb,
  triggered_by       uuid references auth.users (id)
);
create index integration_logs_corr_idx on public.integration_logs (correlation_id);
create index integration_logs_started_idx on public.integration_logs (started_at desc);

-- -----------------------------------------------------------------------------
-- Contexto
-- -----------------------------------------------------------------------------
create or replace function public.audit_request_header(p_name text)
returns text language sql stable
as $$
  select nullif(current_setting('request.headers', true), '')::jsonb ->> p_name
$$;

create or replace function public.audit_actor_id()
returns uuid language plpgsql stable
as $$
declare
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_hdr  text;
begin
  if auth.uid() is not null then
    return auth.uid();
  end if;
  if v_role = 'service_role' then
    v_hdr := public.audit_request_header('x-actor-id');
    if v_hdr ~* '^[0-9a-f-]{36}$' then
      return v_hdr::uuid;
    end if;
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Trigger genérico campo a campo
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
  v_ignored   text[] := array['updated_at', 'updated_by', 'created_at'];
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

do $$
declare t text;
begin
  foreach t in array array[
    'works', 'budgets', 'suppliers', 'contract_types',
    'competitions', 'competition_revisions', 'competition_items', 'competition_suppliers',
    'supplier_proposals', 'supplier_proposal_items', 'best_conditions',
    'approval_steps', 'approvals',
    'contract_requests', 'contract_request_items', 'contract_addenda', 'contract_addendum_items',
    'attachments', 'user_roles', 'role_permissions'
  ]
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_changes()', t, t);
  end loop;
end $$;

-- role_permissions não tem coluna id; o trigger grava entity_id nulo (identificação vai em new_value/old_value).

-- -----------------------------------------------------------------------------
-- audit_logs é append-only
-- -----------------------------------------------------------------------------
create or replace function public.audit_logs_immutable()
returns trigger language plpgsql
as $$
begin
  raise exception 'audit_logs é somente inserção' using errcode = 'P0001';
end;
$$;

create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

revoke update, delete, truncate on public.audit_logs from anon, authenticated;
