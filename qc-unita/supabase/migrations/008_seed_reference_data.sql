-- =============================================================================
-- 008_seed_reference_data.sql
-- Dados de referência obrigatórios: papéis, permissões, fluxo de aprovação e
-- tipos de contrato (aba "Listas" do QC em Excel).
-- Idempotente (on conflict do nothing / do update).
-- =============================================================================

insert into public.roles (key, name, description) values
  ('admin',        'Administrador',                 'Acesso total, configurações e usuários'),
  ('procurement',  'Suprimentos',                   'Monta o QC, convida fornecedores e lança propostas'),
  ('engineering',  'Engenharia',                    'Define escopo, quantidades e valida tecnicamente'),
  ('manager',      'Gerente / Coordenador de Obra', 'Aprova o QC da obra'),
  ('director',     'Diretoria',                     'Aprova QCs acima da alçada'),
  ('viewer',       'Visualizador',                  'Somente leitura')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.permissions (key, description) values
  ('work.read',           'Ver obras'),
  ('work.manage',         'Cadastrar e editar obras'),
  ('budget.read',         'Ver orçamentos'),
  ('catalog.manage',      'Manter catálogo de insumos'),
  ('supplier.read',       'Ver fornecedores'),
  ('supplier.manage',     'Cadastrar e editar fornecedores'),
  ('competition.read',    'Ver quadros de concorrência'),
  ('competition.create',  'Criar quadros de concorrência'),
  ('competition.edit',    'Editar itens, fornecedores e revisões'),
  ('proposal.edit',       'Lançar e editar propostas'),
  ('competition.submit',  'Enviar revisão para aprovação'),
  ('approval.decide',     'Aprovar ou reprovar etapas'),
  ('contract.read',       'Ver solicitações de contrato e aditivos'),
  ('contract.manage',     'Gerar solicitações de contrato e aditivos'),
  ('attachment.upload',   'Enviar anexos'),
  ('audit.read',          'Consultar trilha de auditoria'),
  ('integration.read',    'Ver logs de integração'),
  ('integration.run',     'Disparar sincronização com ERP')
on conflict (key) do update set description = excluded.description;

with matrix(role_key, perm_key) as (
  values
  -- Administrador: tudo
  ('admin','work.read'),('admin','work.manage'),('admin','budget.read'),('admin','catalog.manage'),
  ('admin','supplier.read'),('admin','supplier.manage'),('admin','competition.read'),('admin','competition.create'),
  ('admin','competition.edit'),('admin','proposal.edit'),('admin','competition.submit'),('admin','approval.decide'),
  ('admin','contract.read'),('admin','contract.manage'),('admin','attachment.upload'),('admin','audit.read'),
  ('admin','integration.read'),('admin','integration.run'),
  -- Suprimentos
  ('procurement','work.read'),('procurement','budget.read'),('procurement','supplier.read'),('procurement','supplier.manage'),
  ('procurement','competition.read'),('procurement','competition.create'),('procurement','competition.edit'),
  ('procurement','proposal.edit'),('procurement','competition.submit'),('procurement','approval.decide'),
  ('procurement','contract.read'),('procurement','contract.manage'),('procurement','attachment.upload'),('procurement','audit.read'),
  -- Engenharia
  ('engineering','work.read'),('engineering','budget.read'),('engineering','supplier.read'),('engineering','competition.read'),
  ('engineering','competition.edit'),('engineering','approval.decide'),('engineering','contract.read'),('engineering','attachment.upload'),
  -- Gerente / Coordenador
  ('manager','work.read'),('manager','budget.read'),('manager','supplier.read'),('manager','competition.read'),
  ('manager','approval.decide'),('manager','contract.read'),('manager','audit.read'),
  -- Diretoria
  ('director','work.read'),('director','budget.read'),('director','supplier.read'),('director','competition.read'),
  ('director','approval.decide'),('director','contract.read'),('director','audit.read'),
  -- Visualizador
  ('viewer','work.read'),('viewer','budget.read'),('viewer','competition.read')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from matrix m
  join public.roles r on r.key = m.role_key
  join public.permissions p on p.key = m.perm_key
on conflict do nothing;

-- Fluxo padrão (ajustável em approval_steps)
insert into public.approval_steps (step_order, name, role_id, min_amount)
select v.step_order, v.name, r.id, v.min_amount
  from (values
    (1, 'Suprimentos',                    'procurement', null::numeric),
    (2, 'Engenharia',                     'engineering', null::numeric),
    (3, 'Gerente / Coordenador de Obra',  'manager',     null::numeric),
    (4, 'Diretoria',                      'director',    500000::numeric)
  ) as v(step_order, name, role_key, min_amount)
  join public.roles r on r.key = v.role_key
on conflict (step_order) do nothing;

-- Tipos de contrato (aba "Listas")
insert into public.contract_types (code, name, person_kind, jurisdiction, direct_billing) values
  ('CTD00', 'Minuta de Terceiros',                                                         null,   null, false),
  ('CTD01', 'Prestação de Serviços Engenharia PJ',                                          'cnpj', 'SP', false),
  ('CTD02', 'Empreitada Global Com Fornec. de Material - Sem Fat. Direto',                  'cnpj', 'SP', false),
  ('CTD03', 'Serviços de Elaboração de Imagens',                                            'cnpj', 'SP', false),
  ('CTD04', 'Empreitada Global Com Fornec. de Material - Com Fat. Direto',                  'cnpj', 'SP', true),
  ('CTD05', 'Empreitada Global Sem Fornec. de Material',                                    'cnpj', 'SP', false),
  ('CTD06', 'Locação, Manutenção e Operação de Equipamentos',                               'cnpj', 'SP', false),
  ('CTD07', 'Consultoria',                                                                  'cnpj', 'SP', false),
  ('CTD08', 'Empreitada de MDO Preço Unitário',                                             'cnpj', 'SP', false),
  ('CTD09', 'Elaboração de Projetos',                                                       'cnpj', 'SP', false),
  ('CTD10', 'Empreitada Preço Unitário Com Fornec. de Material - Com Fat. Direto',          'cnpj', 'SP', true),
  ('CTD11', 'Empreitada Global Com Fornec. de Material - Sem Fat. Direto',                  'cpf',  'BH', false),
  ('CTD12', 'Empreitada de MDO Preço Unitário',                                             'cnpj', 'BH', false),
  ('CTD13', 'Locação, Manutenção e Operação de Equipamentos',                               'cpf',  'BH', false),
  ('CTD14', 'Empreitada Global Sem Fornec. de Material',                                    'cpf',  'BH', false),
  ('CTD15', 'Elaboração de Projetos',                                                       'cpf',  'BH', false),
  ('CTD16', 'Elaboração de Projetos',                                                       'cnpj', 'BH', false),
  ('CTD17', 'Empreitada de MDO Preço Unitário',                                             'cpf',  'BH', false),
  ('CTD18', 'Prestação de Serviços Lafaete',                                                'cnpj', 'SP', false),
  ('CTD19', 'Aditivo Contrato - Prestador de Serviços PJ',                                  'cnpj', 'SP', false),
  ('CTD20', 'Prestador de Serviços PJ',                                                     'cnpj', 'SP', false),
  ('CTD21', 'Prestador de Serviços PJ',                                                     'cnpj', 'MG', false),
  ('CTD22', 'Aditivo Contrato - Prestador de Serviços PJ',                                  'cnpj', 'MG', false),
  ('CTD24', 'Distrato',                                                                     'cnpj', null, false),
  ('CTD25', 'Prestador de Serviços PJ - S/ VR',                                             'cnpj', 'SP', false)
on conflict (code) do update set name = excluded.name;
