# Versões do QC Unità

- **dev**: branch local `dev`, onde as alterações são testadas e conferidas.
- **produção**: branch `main` no GitHub, publicada pela Vercel.

Cada versão é uma tag git (`v01`, `v02`…). Uma versão só vai para a produção depois de liberada. O `main` avança até a tag liberada e é enviado ao GitHub com as tags.

## Testes de regressão

O comando `npm run verificar`, rodado em `qc-unita`, checa tipos e cores, roda os testes de regras e de API (Vitest), roda os testes de tela (`npm run test:e2e`, Playwright no Edge) e faz o build.

Os testes de tela ficam em `qc-unita/e2e`. Eles abrem o app inteiro no modo demonstração, com banco em memória e ERP simulado, e nunca tocam no Supabase nem na UAU. Cobrem obras (inclusive arquivar), orçamento e filtros, quadro de concorrências, QC (abas, mapa, preço, "Sem Fornecedor" vencedor), aprovações por alçada, contrato e aditivo, e nova concorrência. Um teste também falha se a página der erro de JavaScript, erro no console ou 5xx na API.
- Toda versão precisa passar nele antes de ganhar a tag.
- Todo bug corrigido ganha um teste que reproduz o problema: o teste falha antes da correção e passa depois.

Três barreiras impedem que uma versão com teste quebrado chegue aos usuários:
1. A tag só é criada depois que o `verificar` passa.
2. O hook `.githooks/pre-push` bloqueia o envio ao `main` se o `verificar` falhar. Ele é ativado com `git config core.hooksPath .githooks`.
3. A Vercel roda `verificar:vercel` (tudo, menos os testes de tela, que precisam de navegador) como build. Se um teste falhar, a produção não é publicada.

| Ambiente | Versão |
|---|---|
| produção | v05 |
| dev | v06 |

## v06 — dev (2026-10-22)

- Concorrência só com o orçamento 100% completo: toda linha com vínculo de planejamento (IP do cadastro da UAU) e todo Item com nome. Enquanto faltar algo, o orçamento e a nova concorrência mostram o aviso "Orçamento incompleto" (quantas linhas sem IP e quais Itens sem nome), o botão Nova concorrência fica bloqueado e o servidor recusa a criação.
- O IP não é mais preenchido com o código do item: linha sem IP no SharePoint, no de-para ou escolhido na obra fica sem IP (inclusive no indireto aberto).
- Manual de uso atualizado (de-para, indireto aberto, orçamento completo para concorrência).

## v05 — produção (2026-10-22)

- Orçamento com mais de 1.000 linhas: a leitura das linhas no Supabase agora vem em páginas. Antes, só as 1.000 primeiras apareciam e o resto (na U050C, o item 16 com o indireto aberto e parte do item 15) ficava sem insumos na tela.
- Indireto: cada aba vai para o item do orçamento com o mesmo tipo de custo na descrição da UAU (M.O.I (PJ), M.O.I (CLT), M.O.D…), e não só pelo código da aba "Total Indiretos". Na U050C o arquivo trazia CLT e PJ trocados entre 16.05 e 16.06.

## v04 — produção (2026-10-22)

- Testes de regras e API isolados do ambiente: no build da Vercel (VERCEL_ENV=production) o modo demonstração era bloqueado e 27 testes falhavam, impedindo a publicação da v03.

## v03 — (2026-10-22, build da Vercel falhou; publicada junto com a v04)

- Atalho `Abrir QC local.bat` para subir o app local.
- Portão de regressão: `npm run verificar`, hook pre-push e build da Vercel.
- Testes de tela (E2E) com Playwright: 20 testes dos fluxos principais.
- De-para do orçamento (tela **De-para**, quem mantém o cadastro): nome e IP por Item da EAP e IP por insumo do indireto. O nome troca o "Item 02" genérico; o IP do Item vai para todas as linhas abaixo dele a cada versão do orçamento do SharePoint. Nome e IP dados na obra continuam valendo sobre o de-para. Migration 022.
- Indireto aberto: **Importar indireto (Excel)** no orçamento das obras do SharePoint lê o arquivo de custo indireto da obra e troca o indireto fechado de cada item pelos insumos abertos, já com o IP do de-para. O indireto fica guardado e volta a cada **Atualizar dados**.
- Textos sem "planilha": "Atualizar dados", "Importar do SharePoint" etc. (telas, mensagens e manual).
- Testes: 178 de regras/API e 22 de tela.

## v02 — produção (2026-10-15)

- Insumos do mapa separados dos insumos referência (ligação N:N): IP herdado das referências e "Sem Fornecedor" como opção. Abas: Vínculos e insumos → Mapa → Fornecedores → Dados.
- Orçamento:
  - filtros por coluna como no Excel, valendo para toda a árvore;
  - IP manual por linha;
  - nome dos Itens editável;
  - todo nível com dependentes totaliza os de baixo.
- Planilha de orçamentos:
  - aba `BD_Orcamento`;
  - diagnóstico do 404;
  - PrecoItem vazio não zera mais a linha.
- UAU: todos os IPs do cadastro, cadastro de insumos sincronizado e tela Consulta UAU.
- Arquivar obra (administrador): a obra sai das listas sem apagar nada.
- Ajustes visuais: orçamento compacto, cabeçalho do mapa e "Enviar ao ERP" oculto.
- Manual de uso em `qc-unita/docs/MANUAL_DE_USO.html`.
- Banco: migrations 017 a 021. Rodar no Supabase antes de liberar.

## v01 — produção (2026-10-13)

- Estado publicado no `main` até o commit 555e087: obra nova pela UAU com o orçamento da planilha do SharePoint, fornecedores da UAU, aditivos e distratos item a item.
