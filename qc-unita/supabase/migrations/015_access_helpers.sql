-- =============================================================================
-- 015_access_helpers.sql
-- Dar e tirar acesso ao QC com uma linha no SQL Editor, sem procurar UUIDs:
--
--   select public.qc_conceder_acesso('fulano@unitaengenharia.com.br', 'admin');
--   select public.qc_conceder_acesso('fulano@unitaengenharia.com.br', 'procurement', '2041');  -- só a obra 2041
--   select public.qc_remover_acesso('fulano@unitaengenharia.com.br', 'procurement');            -- tira o papel (todas as obras)
--   select * from public.qc_acessos;                                                            -- quem tem o quê
--
-- Papéis: admin · procurement (Suprimentos) · engineering (Engenharia) ·
--         manager (Gerente/Coordenador) · director (Diretoria) · viewer (Visualizador)
--
-- Só o dono do banco (SQL Editor) e o service_role executam: o app e os usuários não
-- conseguem chamar estas funções para se dar papéis.
-- =============================================================================

create or replace function public.qc_conceder_acesso(p_email text, p_papel text default 'admin', p_obra text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_user  uuid;
  v_name  text;
  v_role  uuid;
  v_work  uuid;
begin
  select id, coalesce(raw_user_meta_data ->> 'full_name', '') into v_user, v_name
    from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'Usuário % não existe no Supabase Auth. Crie em Authentication → Users.', p_email;
  end if;

  select id into v_role from public.roles where key = lower(trim(p_papel));
  if v_role is null then
    raise exception 'Papel "%" não existe. Use: %.', p_papel, (select string_agg(key, ', ' order by key) from public.roles);
  end if;

  if p_obra is not null then
    select id into v_work from public.works where code = trim(p_obra);
    if v_work is null then raise exception 'Obra % não encontrada.', p_obra; end if;
  end if;

  -- Usuário criado antes do schema não passou pelo gatilho: cria (ou reativa) o perfil
  insert into public.profiles (id, full_name, email, active)
  values (v_user, v_name, lower(trim(p_email)), true)
  on conflict (id) do update set active = true, email = coalesce(public.profiles.email, excluded.email);

  insert into public.user_roles (user_id, role_id, work_id)
  values (v_user, v_role, v_work)
  on conflict do nothing;

  return format('%s agora tem o papel %s em %s.', p_email, lower(trim(p_papel)), coalesce('obra ' || p_obra, 'todas as obras'));
end;
$$;

create or replace function public.qc_remover_acesso(p_email text, p_papel text, p_obra text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.user_roles ur
   using auth.users u, public.roles r
   where ur.user_id = u.id and ur.role_id = r.id
     and lower(u.email) = lower(trim(p_email))
     and r.key = lower(trim(p_papel))
     and (ur.work_id is not distinct from (select id from public.works where code = trim(p_obra)));
  get diagnostics v_count = row_count;
  return case when v_count = 0 then 'Nada removido: o usuário não tinha esse papel.' else format('Papel %s removido de %s.', p_papel, p_email) end;
end;
$$;

revoke all on function public.qc_conceder_acesso(text, text, text) from public, anon, authenticated;
revoke all on function public.qc_remover_acesso(text, text, text) from public, anon, authenticated;

-- Quem tem acesso a quê (só para consulta no SQL Editor)
create or replace view public.qc_acessos as
select p.email, p.full_name as nome, p.active as ativo, r.key as papel, r.name as papel_nome,
       coalesce(w.code || ' — ' || w.name, 'todas as obras') as obra
  from public.profiles p
  left join public.user_roles ur on ur.user_id = p.id
  left join public.roles r on r.id = ur.role_id
  left join public.works w on w.id = ur.work_id
 order by p.email, r.key;

revoke all on public.qc_acessos from public, anon, authenticated;
