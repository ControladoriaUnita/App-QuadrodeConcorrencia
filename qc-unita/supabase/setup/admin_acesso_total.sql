-- =============================================================================
-- Acesso total ao QC para um administrador.
-- Supabase → SQL Editor → troque o e-mail nas 3 linhas marcadas com <<< → Run. Pode rodar de novo
-- quantas vezes quiser (não duplica nada).
--
-- O que faz:
--   1. Garante que o papel "admin" tem TODAS as permissões do app (inclusive as que
--      forem criadas no futuro, por um gatilho).
--   2. Dá ao usuário TODOS os papéis em todas as obras. Necessário porque as aprovações
--      exigem o papel exato da etapa (Gerente, Diretoria...): só "admin" não aprova.
--   3. Ativa o perfil (e cria, se o usuário foi criado antes do schema).
-- =============================================================================
begin;

do $$
begin
  if not exists (select 1 from auth.users where lower(email) = lower('luis.silva@unitaengenharia.com.br')) then   -- <<< e aqui
    raise exception 'Usuário não encontrado no Supabase Auth. Confira o e-mail (nas 3 linhas marcadas com <<<).';
  end if;
end $$;

-- 1. Papel admin com todas as permissões
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r cross join public.permissions p
 where r.key = 'admin'
on conflict do nothing;

create or replace function public.grant_new_permission_to_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.role_permissions (role_id, permission_id)
  select r.id, new.id from public.roles r where r.key = 'admin'
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists permissions_grant_admin on public.permissions;
create trigger permissions_grant_admin
  after insert on public.permissions
  for each row execute function public.grant_new_permission_to_admin();

-- 2 e 3. Usuário com perfil ativo e todos os papéis, em todas as obras
with alvo as (
  select id, email, coalesce(raw_user_meta_data ->> 'full_name', '') as nome
    from auth.users
   where lower(email) = lower('luis.silva@unitaengenharia.com.br')   -- <<< troque o e-mail aqui
), perfil as (
  insert into public.profiles (id, full_name, email, active)
  select id, nome, lower(email), true from alvo
  on conflict (id) do update set active = true
  returning id
)
insert into public.user_roles (user_id, role_id, work_id)
select a.id, r.id, null
  from alvo a cross join public.roles r
on conflict do nothing;

commit;

-- Conferência: devem aparecer os 6 papéis, todos em "todas as obras", e permissões = total
select r.key as papel, r.name as papel_nome, 'todas as obras' as obra,
       (select count(*) from public.role_permissions rp where rp.role_id = r.id) as permissoes_do_papel,
       (select count(*) from public.permissions) as total_de_permissoes
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join auth.users u on u.id = ur.user_id
 where lower(u.email) = lower('luis.silva@unitaengenharia.com.br') and ur.work_id is null   -- <<< e aqui
 order by r.key;
