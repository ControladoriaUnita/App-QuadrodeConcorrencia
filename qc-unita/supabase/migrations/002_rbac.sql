-- =============================================================================
-- 002_rbac.sql
-- Perfis, papéis, permissões e escopo por obra
--
-- Modelo: user_roles(user_id, role_id, work_id NULL = global).
-- Um usuário pode ser "Engenharia" apenas na obra X e "Visualizador" global.
-- =============================================================================

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text,
  job_title   text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,       -- admin | procurement | engineering | manager | director | viewer
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,       -- competition.edit, approval.decide ...
  description text not null,
  created_at  timestamptz not null default now()
);

create table public.role_permissions (
  role_id       uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete cascade,
  work_id     uuid references public.works (id) on delete cascade,   -- NULL = todas as obras
  granted_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
create unique index user_roles_unique on public.user_roles (user_id, role_id, work_id) nulls not distinct;
create index user_roles_user_idx on public.user_roles (user_id);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger roles_set_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Funções de autorização (usadas pelas políticas RLS)
-- SECURITY DEFINER para evitar recursão de RLS; search_path fixo.
-- -----------------------------------------------------------------------------
create or replace function public.auth_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where ur.user_id = auth.uid()
       and r.key = 'admin'
       and ur.work_id is null
  );
$$;

create or replace function public.auth_has_permission(p_permission text, p_work_id uuid default null)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions p on p.id = rp.permission_id
      join public.profiles pr on pr.id = ur.user_id and pr.active
     where ur.user_id = auth.uid()
       and p.key = p_permission
       and (ur.work_id is null or ur.work_id = p_work_id)
  );
$$;

create or replace function public.auth_can_access_work(p_work_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles pr on pr.id = ur.user_id and pr.active
     where ur.user_id = auth.uid()
       and (ur.work_id is null or ur.work_id = p_work_id)
  );
$$;

-- Usuário possui o papel informado (global ou na obra)?
create or replace function public.auth_has_role(p_role_id uuid, p_work_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
     where ur.user_id = auth.uid()
       and ur.role_id = p_role_id
       and (ur.work_id is null or ur.work_id = p_work_id)
  );
$$;

-- Lista de permissões efetivas do usuário logado (consumida pela API/UI)
create or replace function public.auth_my_permissions()
returns table (permission text, work_id uuid)
language sql stable security definer set search_path = public
as $$
  select distinct p.key, ur.work_id
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
   where ur.user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Novo usuário → cria apenas o perfil. Papéis são concedidos explicitamente por um
-- administrador (princípio do menor privilégio: sem papel, nenhuma obra é visível).
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
