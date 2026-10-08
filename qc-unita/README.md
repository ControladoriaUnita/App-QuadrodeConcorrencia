# Quadro de Concorrência — Unità Engenharia

Aplicação web para montar, equalizar e aprovar **Quadros de Concorrência (QC)**: insumos vindos do orçamento da obra, propostas de fornecedores lado a lado, melhor condição por item, comparação com a verba, revisões (rev00, rev01…) com snapshot congelado, fluxo de aprovação por alçada e trilha de auditoria campo a campo.

Stack: **React 19 + TypeScript (strict) + Vite 7 + Tailwind CSS 4** · **Vercel Functions** · **Supabase (PostgreSQL + Auth + Storage)** · Zod · TanStack Query · React Hook Form. Identidade visual: `identidade visual/DESIGN_SYSTEM.md` (tokens em `src/styles/tokens.css`).

---

## Rodando localmente

```bash
npm install
cp .env.example .env        # DATA_SOURCE=memory já vem configurado
npm run dev                 # http://localhost:5173
```

No **modo demonstração** (`DATA_SOURCE=memory`) a API roda dentro do próprio `vite dev`, com repositórios em memória e o `MockERPProvider`. A semente cria a obra 2041 com um recorte real do orçamento da planilha de QC e três concorrências (rascunho, em aprovação e aprovada + rev01). O seletor **"Demonstração — entrar como"** no topo troca de usuário para testar papéis e aprovações (Suprimentos → Engenharia → Gerente).

> O modo memória é bloqueado em produção na Vercel, a menos que `ALLOW_DEMO_MODE=true`.

### Com Supabase

1. Crie o projeto e aplique as migrations: `supabase db push` (ou `supabase migration up`).
2. Configure as variáveis (Vercel → Settings → Environment Variables):

| Variável | Onde | Observação |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | browser | protegidas por RLS |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | server | client do usuário (JWT → RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server apenas** | nunca com prefixo `VITE_`; usada só na sincronização ERP e logs de integração |
| `DATA_SOURCE=supabase` | server | |
| `ERP_PROVIDER=mock` | server | `uau`/`senior` quando houver documentação |

3. Conceda papéis aos usuários em `user_roles` (novo usuário recebe só o perfil — sem papel, nenhuma obra é visível).
4. Rode a sincronização em **Integração ERP → Sincronizar agora** para trazer obras, fornecedores, insumos e orçamentos.

---

## Fluxo de telas

1. **Obras** (tela inicial) — cada obra com seu orçamento geral e o % já comprometido.
2. **Painel da obra** — consumo do orçamento geral (contratado · em aprovação · em cotação · saldo) e as concorrências agrupadas por **tipo de serviço** (vínculo de planejamento / pacote do orçamento), com orçado, consumo e saldo de cada tipo.
3. **QC** — mapa de cotação, **Vínculos e insumos** (consolidador), dados, escopo, fornecedores, aprovações e histórico.
4. **Solicitação de Contrato** — gerada do QC aprovado (botão "Gerar solicitação de contrato"); abas Solicitação, Itens e vínculos, Aditivos. Lista por obra em **Contratos e aditivos**.

### Solicitação de Contrato e Aditivos (abas "Solic. Contrato" / "Solic. Aditivo")

- **Origem**: revisão aprovada do QC, empresa vencedora, tipo de contrato e datas do serviço. Entram os itens com quantidade que a vencedora cotou, ao preço dela; itens que ela não cotou ficam de fora e são anotados nas observações. Vínculos IP · Qtd · Valor vêm dos vínculos de planejamento (valor = quantidade × R$ unitário). Distribuição §1.6 ponderada pelo valor contratado.
- **Seções do formulário**: dados iniciais, contratado e 2º contratado, tipo, distribuição, validade, §3 projetos (folha/arquivo/revisão), §4 escopo técnico, §5 materiais com faturamento direto (obrigatório em CTD04/CTD10), §6 critérios de medição (obrigatório), observações. No rascunho é possível ajustar especificação e % de retenção por item.
- **Ciclo**: rascunho → **enviada a Contratos** (QC passa a "Contratada"; dados e itens travados também por trigger) → **no ERP** (`ERPProvider.pushContract` + `integration_logs`) → **assinado**. Cancelável até ir ao ERP; ao cancelar, o QC volta ao status da revisão corrente. Uma solicitação ativa por concorrência. Novas revisões de um QC contratado não desfazem o contrato.
- **Aditivos**: numerados (1º, 2º…), com motivo, data, nova data de término, quantidade aditiva (± por item do contrato, ou item novo) e R$ unitário. A quantidade acumulada não pode ficar negativa. Fluxo rascunho → aguardando aprovação → **aprovado/reprovado pela Gerência/Diretoria** (papéis `manager`/`director`/`admin` com `approval.decide`; reprovação exige comentário). Um aditivo aberto por vez.
- **Consumo**: aditivos aprovados somam ao **Contratado** da obra (`qc_work_addenda_totals`); a vigência passa a ser a nova data do último aditivo aprovado. Totais da planilha: contrato inicial, total do aditamento, novo total e saldo de verba após aditivos.
- Migration `013_contract_requests.sql`; domínio em `shared/domain/contract/contract-request.ts`.

### Consumo do orçamento

- **Contratado**: revisão efetiva aprovada (última aprovada; uma rev01 em rascunho não substitui a rev00 aprovada até ser aprovada).
- **Em aprovação**: revisão enviada. **Em cotação**: estimativa do rascunho (vencedora indicada, ou melhor condição por item).
- O valor de cada QC é distribuído pelos tipos de serviço conforme os vínculos dos itens; QCs criados por insumos aparecem no tipo de serviço de maior valor.

### Orçamento da obra — importação via Excel

Na obra, **Importar orçamento (Excel)** lê a planilha no navegador — formato padrão: **orçamento analítico** (`NÍVEL · ITEM_PLA · ITEM · SERVIÇO · DESCRIÇÕES · UNID. · QNT · CUSTO UNITÁRIO · CUSTO TOTAL`; SERVIÇO = "Item" é grupo, ITEM preenchido é composição, ITEM vazio é insumo da composição ITEM_PLA; "CUSTO RASO" do topo é usado para conferência; Vínculo PL opcional). O modelo antigo da planilha de QC (aba "Orçamento", com Vínculo PL) continua aceito. Cabeçalho localizado automaticamente e mostra uma prévia (total, linhas, composições, IPs e avisos) antes de gravar. O parser é puro (`shared/domain/budget/excel-import.ts`) e o servidor revalida tudo (Zod + consistência). Cada importação cria uma **nova versão vigente**; versões anteriores e QCs existentes ficam intactos.

- Linha do orçamento = insumo de uma composição com seu Vínculo PL; chave estável `EAP|código|IP[|n]` permite reimportar sem perder vínculos.
- O **Custo Total** da planilha é a referência (o unitário é derivado), igual ao orçamento oficial.
- A aba **Orçamento** da obra mostra a estrutura da planilha (Item → composição → insumos, níveis recolhíveis como no Excel, subtotais por Item) com cada linha com os QCs que a usam (com o % de cada um) e o % / R$ ainda livre.
- Testado com a planilha de exemplo: 3.327 linhas, 903 composições, 176 IPs, R$ 51.752.715,62.

### Vínculos de planejamento (aba "Vínculos e insumos")

**Um QC pode reunir vários IPs.** Na criação escolhem-se os IPs e depois as linhas do orçamento, uma a uma (pré-selecionadas as que têm saldo). No QC, **Adicionar linhas do orçamento** inclui linhas de qualquer IP; cada linha vinculada pode ser ajustada ou desvinculada; itens podem ser removidos.

**% da linha a comprometer (verba puxada).** Para cada linha escolhida o usuário informa o percentual que a contratação compromete (padrão: o % ainda livre; há "Aplicar às selecionadas" para lançar o mesmo % em lote). Esse percentual define:

- **Verba puxada** = Custo Total da linha × % (100% = custo total exato, sem arredondamento);
- **Quantidade vinculada** = quantidade da linha × %.

Gravados em `competition_item_links.budget_share` (`ratio6`) e `budget_value` (`money4`) — migration `012_link_share.sql`. A soma dos % de uma linha entre os QCs da obra (revisão efetiva de cada um) não pode passar de 100%: o servidor recusa com `SHARE_OVER_BALANCE`, e a tela mostra o máximo livre. Na aba Vínculos, cada linha tem os campos **% da linha** e **Qtd. vinculada** (editar um recalcula o outro); o orçado do item/QC passa a ser a soma das verbas puxadas, e a quantidade do item acompanha a soma vinculada quando estava fechada com ela.


Cada item do QC é amarrado a um ou mais pares **insumo do orçamento × vínculo de planejamento** com quantidade (`competition_item_links`). Na criação a amarração vem do orçamento; o usuário pode trocar o insumo, o vínculo (filtrado pelos vínculos onde aquele insumo existe), dividir quantidades, incluir/remover vínculos e "Ajustar proporcional". O orçado do item e do QC passa a ser o orçamento dos vínculos selecionados. A soma vinculada deve fechar com a quantidade do item para enviar à aprovação. O consolidador mostra, por vínculo e por insumo: orçado × outros QCs da obra × este QC × saldo (destaca o que ficaria acima do orçado).

---

## Arquitetura

```
UI (React)  →  /api/* (Vercel Function única)  →  Casos de uso  →  Domínio puro  
                     server/http/router.ts         server/application   shared/domain
                                                        │
                                                        ▼
                                              Portas (ports.ts)
                                       ┌────────────┴────────────┐
                              Repositórios Supabase       Repositórios em memória
                              (RLS + triggers)            (dev/demo/testes)
                                       │
                               PostgreSQL (Supabase)
                                                        ERPProvider (Mock | UAU | Senior) — só no servidor
```

```
api/router.ts                    Vercel Function (rewrite /api/* → /api/router)
server/
  http/router.ts                 controllers finos + validação Zod + erros padronizados + correlationId
  application/
    context.ts                   Actor, permissões, AppError
    ports.ts                     interfaces dos repositórios
    use-cases/                   competitions · contracts · catalog · works · erp-sync
  infrastructure/
    supabase/                    clients (user/service) + repositórios
    memory/                      banco em memória com as mesmas garantias + semente
    erp/                         ERPProvider, MockERPProvider, stubs UAU/Senior
shared/
  domain/                        Decimal (BigInt), melhor condição, orçamento, revisões, aprovação, snapshot, distribuição
  contracts/                     DTOs + schemas Zod usados por UI e API
  format.ts                      formatação pt-BR (sem float)
src/
  styles/tokens.css              única fonte de cores/tipos/raios/sombras
  components/ui, components/layout
  features/competitions          lista, mapa do QC, dados, escopo, fornecedores, aprovações, histórico
  features/contracts             solicitação de contrato, itens e vínculos, aditivos
  features/catalog, integration, auth
supabase/
  migrations/001…013             schema versionado (nada manual no painel)
  tests/                         smoke de RLS/auditoria/congelamento + usuários do teste de integração
```

**O domínio é compartilhado**: `buildQcMap()` roda na API (para persistir melhores condições e validar o envio) e no browser (recalcula o mapa instantaneamente enquanto o preço é digitado, com atualização otimista). A regra é uma só.

### Valores monetários

- Banco: `numeric(18,4)` (domínios `money4`, `qty4`; percentuais `ratio6` 0..1).
- Leitura via PostgREST com cast `::text` — o JSON nunca passa por `float`.
- Domínio: classe `Decimal` sobre `BigInt`, arredondamento half-up. Entrada do usuário aceita `1.234,56`, `1234,56`, `R$ 150.000`.

---

## Do Excel para o modelo relacional

| Planilha (`QC rev00`, `Orçamento`, `Insumos`, `Listas`, `Solic. Contrato/Aditivo`) | Modelo |
|---|---|
| Orçamento: Item (EAP) → Composição (CPU/CPO) → Insumo (IM/IS/IP) + **Vínculo PL** | `budgets` → `budget_items` (EAP) → `activities` → `activity_items` (`package_code`) · `materials` |
| QC: insumos do pacote, QUANT. somada, R$ UNIT. médio | `competition_items` (cópia congelável: orçado + quantidade equalizada, % mat/equip/ret, escopo) |
| Colunas de fornecedores (Razão, Fantasia, Contato, CNPJ, Validade CND) | `suppliers` + `competition_suppliers` (snapshot dos dados na revisão + condições comerciais) |
| R$ UNIT./R$ TOTAL/OBS por fornecedor | `supplier_proposals` + `supplier_proposal_items` |
| Melhores Condições (MINIFS ≠ 0) | `best_conditions` (calculado no domínio; override manual com justificativa) |
| Total orçado, Verba já utilizada, Acréscimos/Reduções, Verba disponível, Resultado QC/Orçamento | `competition_revisions.budget_*` + `compareWithBudget()` |
| R$ Total Equalizado rev00/rev01/rev02 | `competition_revisions` (uma linha por revisão, cópia integral via `qc_clone_revision`) |
| Prazo, Pagamento, Reajuste, Pontos +/−, Empresa vencedora, Justificativa, Tipo de contrato | `competition_suppliers.*_terms`, `competition_revisions.winner_*`, `contract_types` (aba Listas) |
| "Faltam campos a serem preenchidos" | `validateForSubmission()` |
| Aprovações (Gerente/Coordenador…) | `approval_steps` (alçadas) + `approvals` |
| Solic. Contrato §1.6 Distribuição | `computeDistribution()` · `contract_requests`/`contract_request_items` |
| Vínculos por bloco/pavimento | `contract_item_allocations` |
| Análise IPs (Custo Orçado × Seleção QC por IP) / colunas "Vínculos" | `competition_item_links` + `consolidate()` + `qc_work_link_commitments` |
| Solic. Aditivo | `contract_addenda` + `contract_addendum_items` |

---

## Regras de negócio implementadas

- **Melhor condição**: menor R$ unitário > 0 entre fornecedores participantes; empate → coluna mais à esquerda; total = unitário × quantidade equalizada (4 casas).
- **Ranking**: só propostas completas (todos os itens com quantidade). Resultado = verba disponível − total; % sobre o total orçado.
- **Revisões**: só rascunho é editável; uma revisão aberta por vez; nova revisão copia a última aprovada/reprovada.
- **Aprovação**: sequencial; quem decide precisa do papel da etapa (global ou na obra); reprovação exige comentário; Diretoria só acima de R$ 500 mil (configurável em `approval_steps`).
- **Congelamento**: aprovada ⇒ snapshot JSON canônico + SHA-256; triggers `guard_frozen_revision*` bloqueiam qualquer UPDATE/DELETE na revisão e nos filhos, inclusive vindos do ERP ou do service role. Única transição permitida: `approved → superseded`.
- **Validação de envio**: datas, responsáveis, tipo de contrato, vencedora + justificativa, ≥ 3 fornecedores participantes, todos os itens cotados, CND da vencedora vigente.

## Segurança

- **RLS em todas as tabelas** (`006_rls.sql`), baseada em `auth.uid()` + `user_roles` (papel global ou por obra) + `role_permissions`.
- A API usa o **JWT do usuário** em todas as operações de negócio — o banco reaplica as permissões mesmo que a API falhe.
- `service_role` só na sincronização ERP e em `integration_logs`.
- Storage: bucket privado `qc-attachments`, caminho `{work_id}/{entidade}/{id}/arquivo`, políticas por obra (`007_storage.sql`); a tabela `attachments` guarda só metadados.

## Auditoria

Trigger `audit_row_changes()` em todas as tabelas críticas grava **uma linha por campo alterado**: `user_id`, `entity`, `entity_id`, `field`, `old_value`, `new_value`, `revision_id`, `work_id`, `origin` e `correlation_id`. A API envia `x-audit-origin` e `x-correlation-id` (headers do PostgREST); com service role, `x-actor-id` identifica o usuário real. `audit_logs` é append-only.

## Integração ERP

`ERPProvider` (`getWorks`, `getWork`, `getBudget`, `getSuppliers`, `getMaterials`, `pushContract`). Hoje: `MockERPProvider`; `uau`/`senior` lançam `ErpNotConfiguredError` até a documentação oficial. Cada operação gera `integration_logs` (data/hora, provider, operação, ID, status, contagens, mensagem/erro, `correlationId`). A sincronização reconstrói as linhas do orçamento — QCs guardam cópia própria e revisões aprovadas estão congeladas.

---

## Testes

```bash
npm run check              # typecheck (app + server) + regra "nenhum hex fora de tokens.css" + testes
npm test                   # domínio (Decimal, melhor condição, revisões, aprovação) + API em memória
npm run test:integration   # repositórios Supabase contra PostgREST real (ver supabase/tests)
```

O teste de integração foi executado contra Postgres 16 + PostgREST 12 com as migrations deste repositório (RLS, triggers de auditoria e congelamento ativos).

## Próximos passos sugeridos

1. ~~Telas de **Solicitação de Contrato** e **Aditivos**~~ — feito (migration 013).
2. Upload de anexos (propostas/memoriais) usando o bucket e a tabela `attachments`.
3. Implementar `UauERPProvider`/`SeniorERPProvider` e agendar a sincronização (Vercel Cron).
4. Gerar tipos do banco (`supabase gen types typescript`) e tipar os repositórios.
5. Exportação do mapa em PDF/Excel no layout atual da planilha.
