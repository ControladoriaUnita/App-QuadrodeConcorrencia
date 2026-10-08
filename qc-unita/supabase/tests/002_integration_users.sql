-- Usuários usados por server/infrastructure/supabase/supabase.integration.test.ts
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', 'admin@it.local',       '{"full_name":"Admin IT"}'),
  ('10000000-0000-4000-8000-000000000002', 'suprimentos@it.local', '{"full_name":"Suprimentos IT"}'),
  ('10000000-0000-4000-8000-000000000003', 'engenharia@it.local',  '{"full_name":"Engenharia IT"}'),
  ('10000000-0000-4000-8000-000000000004', 'gerente@it.local',     '{"full_name":"Gerente IT"}')
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id)
select u.id::uuid, r.id from (values
  ('10000000-0000-4000-8000-000000000001', 'admin'),
  ('10000000-0000-4000-8000-000000000002', 'procurement'),
  ('10000000-0000-4000-8000-000000000003', 'engineering'),
  ('10000000-0000-4000-8000-000000000004', 'manager')
) as u(id, role) join public.roles r on r.key = u.role
on conflict do nothing;
