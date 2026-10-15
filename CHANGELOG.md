# Versões do QC Unità

- **dev**: branch local `dev`, onde as alterações são testadas e conferidas.
- **produção**: branch `main` no GitHub, publicada pela Vercel.

Cada versão é uma tag git (`v01`, `v02`…). Uma versão só vai para a produção depois de liberada. O `main` avança até a tag liberada e é enviado ao GitHub com as tags.

| Ambiente | Versão |
|---|---|
| produção | v01 |
| dev | v02 |

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
