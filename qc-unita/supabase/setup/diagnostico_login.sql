-- =============================================================================
-- Diagnóstico do login do QC — só LEITURA, não altera nada no banco.
-- Supabase → SQL Editor → cole tudo → troque o e-mail na última linha → Run.
-- Cada linha da resposta é um item: OK ou o que falta.
-- =============================================================================
create or replace function pg_temp.qc_diagnostico(p_email text)
returns table (item text, resultado text)
language plpgsql
as $$
declare
  v_user  uuid;
  v_conf  timestamptz;
  v_txt   text;
  v_bool  boolean;
begin
  item := '1. Schema do QC (public.works, public.user_roles)';
  resultado := case
    when to_regclass('public.works') is not null and to_regclass('public.user_roles') is not null then 'OK'
    when to_regclass('public.profiles') is not null then 'FALTA: este banco tem outro app (ex.: Cadastro de Insumos), mas não o QC. O script do QC não foi aplicado'
    else 'FALTA: rode qc_unita_schema_completo.sql neste projeto' end;
  return next;

  select id, email_confirmed_at into v_user, v_conf from auth.users where lower(email) = lower(trim(p_email));
  item := '2. Usuário no Supabase Auth';
  resultado := case when v_user is null then 'FALTA: crie em Authentication → Users (ou confira o e-mail digitado)' else 'OK' end;
  return next;
  if v_user is null then return; end if;

  item := '3. E-mail confirmado';
  resultado := case when v_conf is null then 'FALTA: no usuário, use "Confirm email" (ou recrie com "Auto confirm")' else 'OK' end;
  return next;

  if to_regclass('public.works') is null then return; end if;

  item := '4. Perfil do QC (public.profiles)';
  begin
    execute 'select active from public.profiles where id = $1' into v_bool using v_user;
    resultado := case when v_bool is null then 'FALTA: usuário criado antes do schema. Rode: select public.qc_conceder_acesso(''seu e-mail'', ''admin'');'
                      when not v_bool then 'FALTA: perfil desativado. Rode: select public.qc_conceder_acesso(''seu e-mail'', ''admin'');'
                      else 'OK' end;
  exception when others then
    resultado := 'ERRO ao ler profiles: ' || sqlerrm;
  end;
  return next;

  item := '5. Papel no QC (public.user_roles)';
  execute $q$
    select string_agg(r.key || coalesce(' (obra ' || w.code || ')', ' (todas as obras)'), ', ')
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      left join public.works w on w.id = ur.work_id
     where ur.user_id = $1 $q$ into v_txt using v_user;
  resultado := coalesce('OK: ' || v_txt, 'FALTA: nenhum papel. Rode: select public.qc_conceder_acesso(''seu e-mail'', ''admin'');');
  return next;
end;
$$;

select * from pg_temp.qc_diagnostico('luis.silva@unitaengenharia.com.br');
