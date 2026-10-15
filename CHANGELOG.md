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
| produção | v01 |
| dev | v02 |

## v03 — em andamento

- Atalho `Abrir QC local.bat` para subir o app local.
- Portão de regressão: `npm run verificar`, hook pre-push e build da Vercel.
- Testes de tela (E2E) com Playwright: 20 testes dos fluxos principais.

## v02 — dev (2026-10-15)

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
