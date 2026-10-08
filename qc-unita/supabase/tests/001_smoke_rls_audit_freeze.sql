-- Smoke test das migrations (RLS, auditoria, congelamento de revisão, clonagem).
-- Uso local: aplicar 000_supabase_stub.sql + migrations em um Postgres 15+ e rodar este arquivo.
-- Espera-se: works_visiveis_compras=1, NOTICEs "OK", comps_visiveis_sem_papel=0.
\set QUIET on
-- usuários
insert into auth.users (id,email) values ('11111111-1111-1111-1111-111111111111','compras@unita'),('22222222-2222-2222-2222-222222222222','gerente@unita'),('33333333-3333-3333-3333-333333333333','visit@unita');
insert into public.works (id, code, name, status) values ('aaaaaaaa-0000-0000-0000-000000000001','OB-001','Residencial Alpha','active'),('aaaaaaaa-0000-0000-0000-000000000002','OB-002','Outra obra','active');
insert into public.user_roles (user_id, role_id, work_id) select '11111111-1111-1111-1111-111111111111', id, 'aaaaaaaa-0000-0000-0000-000000000001' from roles where key='procurement';
insert into public.user_roles (user_id, role_id, work_id) select '22222222-2222-2222-2222-222222222222', id, null from roles where key='manager';
insert into public.budgets (id, work_id, version, is_current, status) values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1,true,'active');
insert into public.suppliers (id, legal_name, tax_id) values ('cccccccc-0000-0000-0000-000000000001','Terra Forte Ltda','12345678000190');

-- Como Suprimentos (authenticated) via headers PostgREST
set role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',false);
select set_config('request.headers','{"x-audit-origin":"ui","x-correlation-id":"corr-123"}',false);
select count(*) as works_visiveis_compras from works;  -- espera 1
insert into competitions (id, work_id, budget_id, code, title) values ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','QC-0001','Terraplenagem');
insert into competition_revisions (id, competition_id, number) values ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',0);
insert into competition_items (id, revision_id, code, description, unit, budget_quantity, budget_unit_cost, quantity) values ('ffffffff-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','IS00017','Bota fora','m³',351,60,351);
update competition_items set quantity = 360 where id='ffffffff-0000-0000-0000-000000000001';
-- tentativa em obra sem acesso
do $$ begin
  insert into competitions (work_id, budget_id, code, title) values ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','QC-X','x');
  raise notice 'FALHA: RLS permitiu';
exception when insufficient_privilege then raise notice 'OK: RLS bloqueou insert em obra sem acesso'; end $$;
-- congelar
update competition_revisions set status='approved', snapshot='{}'::jsonb, snapshot_hash='x', frozen_at=now() where id='eeeeeeee-0000-0000-0000-000000000001';
do $$ begin
  update competition_items set quantity = 1 where id='ffffffff-0000-0000-0000-000000000001';
  raise notice 'FALHA: alterou revisão congelada';
exception when others then raise notice 'OK: %', sqlerrm; end $$;
do $$ begin
  update competition_revisions set reason='x' where id='eeeeeeee-0000-0000-0000-000000000001';
  raise notice 'FALHA';
exception when others then raise notice 'OK: %', sqlerrm; end $$;
-- nova revisão por clonagem
select qc_clone_revision('eeeeeeee-0000-0000-0000-000000000001','Ajuste de escopo') is not null as clonou;
select number, status from competition_revisions order by number;
select count(*) as itens_rev1 from competition_items i join competition_revisions r on r.id=i.revision_id where r.number=1;
-- visitante sem papel
select set_config('request.jwt.claims','{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',false);
select count(*) as comps_visiveis_sem_papel from competitions;
reset role;
select entity, action, field, old_value, new_value, origin, correlation_id, user_id is not null as tem_user, revision_id is not null as tem_rev, work_id is not null as tem_obra from audit_logs where entity in ('competition_items') order by id;
