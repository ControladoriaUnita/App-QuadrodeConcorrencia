-- =============================================================================
-- 028_approval_flows.sql
-- Fluxos de aprovação configuráveis, tipo/origem/diretor do pedido e aprovação de aditivos
-- em etapas.
--
--   * approval_directors: diretores aprovadores (RT, SR…), escolhidos pelo solicitante na criação
--     do QC. Não ficam presos às obras. Com usuário ligado, só ele decide as etapas de diretor.
--   * competitions.request_kind (material | labor), origin (work | procurement), director_id.
--   * approval_flows + approval_flow_steps: fluxo por tipo de solicitação:
--       competition (contratação), deviation (desvio de custo/quantidade, somado ao fluxo da
--       contratação quando o mapa tem desvio), addendum (aditivo/distrato), deadline (só prazo).
--     O fluxo vale para a origem, o tipo e o diretor informados (null = qualquer). O mais
--     específico vence. Cada etapa: papel, alçada mínima e se é a etapa do diretor responsável.
--   * approvals.director_id e addendum_approvals: a etapa do diretor fica com o diretor do QC.
--   * Sem fluxo de contratação configurado, vale approval_steps (comportamento anterior).
--   * Configurar fluxos e diretores: administrador.
-- =============================================================================

-- Diretores ---------------------------------------------------------------------------
create table if not exists public.approval_directors (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (length(trim(code)) between 1 and 10),
  name        text not null check (length(trim(name)) >= 2),
  user_id     uuid references auth.users (id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
insert into public.approval_directors (code, name) values ('RT', 'Diretor RT'), ('SR', 'Diretor SR')
on conflict (code) do nothing;

-- Pedido: tipo, origem e diretor -------------------------------------------------------
alter table public.competitions
  add column if not exists request_kind text check (request_kind is null or request_kind in ('material', 'labor')),
  add column if not exists origin text check (origin is null or origin in ('work', 'procurement')),
  add column if not exists director_id uuid references public.approval_directors (id);

-- Fluxos --------------------------------------------------------------------------------
create table if not exists public.approval_flows (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('competition', 'deviation', 'addendum', 'deadline')),
  name          text not null check (length(trim(name)) >= 3),
  origin        text check (origin is null or origin in ('work', 'procurement')),
  request_kind  text check (request_kind is null or request_kind in ('material', 'labor')),
  director_id   uuid references public.approval_directors (id) on delete cascade,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.approval_flow_steps (
  id          uuid primary key default gen_random_uuid(),
  flow_id     uuid not null references public.approval_flows (id) on delete cascade,
  step_order  integer not null check (step_order >= 1),
  name        text not null check (length(trim(name)) >= 2),
  role_id     uuid not null references public.roles (id),
  director    boolean not null default false,
  min_amount  public.money4,
  active      boolean not null default true,
  unique (flow_id, step_order)
);

-- Etapa do diretor responsável nas instâncias
alter table public.approvals add column if not exists director_id uuid references public.approval_directors (id);

-- Aprovação de aditivos/distratos em etapas
create table if not exists public.addendum_approvals (
  id           uuid primary key default gen_random_uuid(),
  addendum_id  uuid not null references public.contract_addenda (id) on delete cascade,
  step_order   integer not null,
  step_name    text not null,
  role_id      uuid not null references public.roles (id),
  director_id  uuid references public.approval_directors (id),
  status       public.approval_status not null default 'pending',
  decided_by   uuid references auth.users (id),
  decided_at   timestamptz,
  comment      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (addendum_id, step_order),
  constraint addendum_approvals_decision_consistent check (
    (status in ('pending', 'skipped') and decided_at is null)
    or (status in ('approved', 'rejected') and decided_at is not null and decided_by is not null)
  ),
  constraint addendum_approvals_reject_needs_comment check (status <> 'rejected' or coalesce(trim(comment), '') <> '')
);

-- updated_at e auditoria
do $$
declare t text;
begin
  foreach t in array array['approval_directors', 'approval_flows', 'addendum_approvals'] loop
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$s', t);
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Fluxos iniciais (os aprovadores definitivos são cadastrados depois, na tela de fluxos) --
do $$
declare
  v_flow uuid;
  v_director_role uuid := (select id from public.roles where key = 'director');
  v_manager_role  uuid := (select id from public.roles where key = 'manager');
  v_dir record;
begin
  if exists (select 1 from public.approval_flows) then
    return;
  end if;

  -- Contratação (padrão): as etapas atuais de approval_steps
  insert into public.approval_flows (kind, name) values ('competition', 'Contratação (padrão)') returning id into v_flow;
  insert into public.approval_flow_steps (flow_id, step_order, name, role_id, min_amount, active)
  select v_flow, step_order, name, role_id, min_amount, active from public.approval_steps;

  -- Contratação de serviço (RT / SR): as etapas atuais + o diretor responsável
  for v_dir in select id, code from public.approval_directors order by code loop
    insert into public.approval_flows (kind, name, director_id)
    values ('competition', 'Contratação de serviço (' || v_dir.code || ')', v_dir.id) returning id into v_flow;
    insert into public.approval_flow_steps (flow_id, step_order, name, role_id, min_amount, active)
    select v_flow, step_order, name, role_id, min_amount, active from public.approval_steps where role_id <> v_director_role;
    insert into public.approval_flow_steps (flow_id, step_order, name, role_id, director)
    values (v_flow, (select coalesce(max(step_order), 0) + 1 from public.approval_flow_steps where flow_id = v_flow),
            'Diretor responsável (' || v_dir.code || ')', v_director_role, true);
  end loop;

  insert into public.approval_flows (kind, name) values ('deviation', 'Desvio de custo ou quantidade') returning id into v_flow;
  insert into public.approval_flow_steps (flow_id, step_order, name, role_id, director)
  values (v_flow, 1, 'Diretor responsável (desvio)', v_director_role, true);

  insert into public.approval_flows (kind, name) values ('addendum', 'Aditivo / distrato') returning id into v_flow;
  insert into public.approval_flow_steps (flow_id, step_order, name, role_id)
  values (v_flow, 1, 'Gerente / Coordenador de Obra', v_manager_role);

  insert into public.approval_flows (kind, name) values ('deadline', 'Aditivo de prazo contratual') returning id into v_flow;
  insert into public.approval_flow_steps (flow_id, step_order, name, role_id)
  values (v_flow, 1, 'Gerente / Coordenador de Obra', v_manager_role);
end $$;

-- RLS -----------------------------------------------------------------------------------
alter table public.approval_directors enable row level security;
alter table public.approval_flows enable row level security;
alter table public.approval_flow_steps enable row level security;
alter table public.addendum_approvals enable row level security;

drop policy if exists approval_directors_select on public.approval_directors;
create policy approval_directors_select on public.approval_directors for select to authenticated using (true);
drop policy if exists approval_directors_admin on public.approval_directors;
create policy approval_directors_admin on public.approval_directors for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

drop policy if exists approval_flows_select on public.approval_flows;
create policy approval_flows_select on public.approval_flows for select to authenticated using (true);
drop policy if exists approval_flows_admin on public.approval_flows;
create policy approval_flows_admin on public.approval_flows for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

drop policy if exists approval_flow_steps_select on public.approval_flow_steps;
create policy approval_flow_steps_select on public.approval_flow_steps for select to authenticated using (true);
drop policy if exists approval_flow_steps_admin on public.approval_flow_steps;
create policy approval_flow_steps_admin on public.approval_flow_steps for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

drop policy if exists addendum_approvals_select on public.addendum_approvals;
create policy addendum_approvals_select on public.addendum_approvals for select to authenticated
  using (public.auth_has_permission('contract.read', public.addendum_work_id(addendum_id)));
drop policy if exists addendum_approvals_insert on public.addendum_approvals;
create policy addendum_approvals_insert on public.addendum_approvals for insert to authenticated
  with check (public.auth_has_permission('contract.manage', public.addendum_work_id(addendum_id)));
-- Só decide quem tem o papel da etapa + approval.decide (o diretor ligado é conferido pela API)
drop policy if exists addendum_approvals_decide on public.addendum_approvals;
create policy addendum_approvals_decide on public.addendum_approvals for update to authenticated
  using (status = 'pending'
         and public.auth_has_role(role_id, public.addendum_work_id(addendum_id))
         and public.auth_has_permission('approval.decide', public.addendum_work_id(addendum_id)))
  with check (public.auth_has_role(role_id, public.addendum_work_id(addendum_id)));
-- Reenvio do rascunho refaz o plano
drop policy if exists addendum_approvals_reset on public.addendum_approvals;
create policy addendum_approvals_reset on public.addendum_approvals for delete to authenticated
  using (public.auth_has_permission('contract.manage', public.addendum_work_id(addendum_id)));

grant select on public.approval_directors, public.approval_flows, public.approval_flow_steps to authenticated;
grant insert, update, delete on public.approval_directors, public.approval_flows, public.approval_flow_steps to authenticated;
grant select, insert, update, delete on public.addendum_approvals to authenticated;
