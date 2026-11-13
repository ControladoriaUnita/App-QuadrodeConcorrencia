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
| produção | v11 |
| dev | v14 |

## v14 — dev (2026-11-13)

- **Fora de escopo ligado ao QC:**
  - toda solicitação fora de escopo aponta a concorrência (QC) a que se refere. O campo é obrigatório na tela quando a obra tem concorrências, e a lista mostra o link para o QC;
  - no **mapa de cotação**, cada insumo ganhou **Quant. FE** e **Unit. FE**. Insumo sem referência do orçamento já vem 100% fora de escopo; no insumo orçado, digita-se só a parte nova. Unit. FE é o preço contratado;
  - o rodapé do mapa mostra o fora de escopo e o total e o resultado **sem** fora de escopo, além dos totais **com** ele;
  - as linhas fora de escopo dos mapas aparecem sozinhas na aba **Fora de escopo**, em "Apontados nos QCs", com link para o QC de origem, e entram no total da obra.
- **Desvio por linha:** o mapa marca na própria linha **desvio de preço** (preço contratado acima do unitário orçado) e **desvio de quantidade** (quantidade dentro do escopo acima da orçada), nunca por pacote ou Item da EAP. Desvio é diferente de fora de escopo: vale para insumos que estão no orçamento.
- Banco: migration `027_qc_out_of_scope.sql`:
  - coluna de quantidade fora de escopo no insumo do mapa, copiada para a nova revisão;
  - ligação do lançamento ao QC.
  Rodar no Supabase antes de liberar, depois da 025 e da 026.

## v13 — dev (2026-11-13)

- **Contrato sem assinatura e sem ERP:** a aprovação acontece no QC, então a solicitação de contrato passa direto a **Concluído** ao clicar em **Enviar e concluir**. Saíram os botões **Registrar assinatura** e **Enviar ao ERP** e as rotas deles (não há API de contrato na UAU). Contratos antigos "No ERP" ou "Assinado" aparecem como Concluído e continuam aceitando aditivos.
- **Aditivo com acréscimo e redução (remanejamento):** no mesmo aditivo, cada item do contrato pode **acrescentar (+)** ou **reduzir (−)**. Exemplo: zerar uma linha (botão **zerar**) e acrescentar a quantidade em outra linha ou num item novo. A redução:
  - usa o preço contratado;
  - não passa da quantidade vigente do item nem da de cada IP.
- O aditivo mostra acréscimos, reduções e o líquido; o líquido é o que entra no contrato. A transferência de saldo é digitada pelo usuário, sem cálculo automático.
- Simulado: o cenário "contrato assinado" virou "contrato concluído".
- Banco: migration `026_addendum_reduce_lines.sql` (só a regra de sinal dos itens do aditivo). Rodar no Supabase antes de liberar. Também é preciso rodar a `025` da v12.

## v12 — dev (2026-11-12)

- **Custos fora de escopo:** aba nova **Fora de escopo** na obra, entre Orçamento e Concorrências, para lançar o que a obra precisa e que não está previsto no orçamento. Cada lançamento recebe um número da obra (FE-001, FE-002…) e guarda:
  - insumo (do cadastro ou livre), unidade, quantidade e custo unitário (total = quantidade × unitário);
  - data, **motivo** e **justificativa** obrigatória;
  - quem solicitou e, se quiser, o Item da EAP do orçamento vigente e o IP.
- A tela mostra:
  - o total fora de escopo;
  - o peso sobre o orçamento vigente, em destaque acima de 5%;
  - o orçamento + fora de escopo;
  - o resumo por motivo e por Item da EAP;
  - a lista com busca e filtro por motivo, com editar e excluir.
- Lançam Administrador, Suprimentos e Engenharia (permissão nova `out_of_scope.manage`, dada aos papéis que mantêm o orçamento); os demais só consultam. Tudo fica na auditoria.
- Por enquanto os lançamentos ficam à parte: não entram no comprometido do orçamento nem nas concorrências.
- Banco: migration `025_out_of_scope_costs.sql`. Rodar no Supabase antes de liberar.

## v11 — produção (2026-11-03)

- Simulado: os fornecedores passam a ser escolhidos entre empresas de obra (construtora, engenharia, concreto, terraplenagem, materiais de construção…), com CND válida. Em ordem alfabética pura, o cadastro da UAU fazia o simulado usar cartórios ("1 TABELIAO DE PROTESTO…") e lojas de filtros.

## v10 — produção (2026-11-03)

- **Excluir obra (administrador):** botão no orçamento da obra e na lista de arquivadas. Apaga a obra de vez, com orçamentos, concorrências, contratos, aditivos e anexos (também os arquivos). Para confirmar, digita-se o número da obra; o botão só libera com o número certo. Fica um registro da exclusão na auditoria. As travas de revisão congelada e de contrato enviado não impedem a exclusão, mas continuam valendo para o uso normal.
- **Gerar simulado (administrador):** no orçamento da obra. Apaga as concorrências, contratos e anexos da obra (a obra e o orçamento ficam) e cria uma concorrência em cada estágio, a partir do orçamento dela: em cotação (convite; propostas com cotação escolhida em andamento), em aprovação parada em cada alçada ativa, reprovada, aprovada, cotação escolhida com uma solicitação por empresa, solicitação enviada, contrato assinado, aditivo aguardando e aprovado, distrato, solicitação cancelada e contratado com nova revisão. Cada cenário passa pelas mesmas regras das telas; o andamento aparece cenário a cenário, com o link de cada QC.
- Banco: migration `024_purge_work.sql` (função `qc_purge_work`, só para o servidor) — rodar no Supabase antes de liberar.

## v09 — produção (2026-11-03)

- **Segurança — edição só da revisão aberta:** as rotas de preço, item, fornecedor e escolha manual conferiam a permissão e a trava na revisão da URL, mas aceitavam ids de outra revisão. Com a URL de um rascunho dava para alterar preços de um QC em aprovação (ou já aprovado). Agora todo item ou fornecedor informado precisa ser da revisão da URL.
- **Quantidade e preço negativos recusados pela API:** a tela já bloqueava, mas uma chamada direta gravava, por exemplo, quantidade −1000, baixando o total do fornecedor e a alçada de aprovação.
- **Modo demonstração voltou a abrir:** as CNDs dos fornecedores de exemplo tinham data fixa; em 01/11/2026 a da vencedora do Contrapiso venceu, a carga dos exemplos falhava e, com ela, os testes (o `verificar` bloqueava qualquer envio). As datas agora são relativas a hoje. A produção (Supabase) não era afetada.
- **Mapa acima de 1.000 linhas:** no Supabase, insumos, preços, vínculos e referências do QC eram lidos de uma vez e o PostgREST corta em 1.000; com, por exemplo, 200 insumos × 6 fornecedores os preços excedentes sumiam calados e o recálculo gravava totais errados. Agora vêm em páginas, assim como o comprometido da obra e a conferência de linhas na reimportação do orçamento (obra grande deixava linhas antigas para trás).
- **Aprovação pela cotação escolhida:** com empresa escolhida por insumo, a vencedora única fica opcional; para enviar, todo insumo com quantidade precisa de empresa que cotou o preço e com CND válida (antes só a CND da vencedora era conferida). A alçada usa o total escolhido e a aba Aprovações mostra a divisão por empresa.
- **Comprometido e verba pela cotação escolhida:** o valor contratado de cada insumo (comprometido da obra) passa a ser o da empresa escolhida. Cada solicitação de contrato gerada recebe a verba dos seus insumos — antes cada uma levava a verba do QC inteiro e a economia de cada contrato saía inflada.
- **Linhas de outra obra:** puxar linhas para o QC aceitava linha do orçamento de outra obra (com o saldo calculado contra os compromissos errados). Agora só da mesma obra.
- **Número da solicitação:** passa a ser o maior da obra + 1 (pela contagem, uma falha na sequência repetia um número) e, se dois pedidos simultâneos colidirem, tenta de novo com o próximo em vez de dar erro. Se a gravação dos itens falhar, o cabeçalho é desfeito para não bloquear a empresa.
- Telas: erro de validação diz o motivo (ex.: "Percentual deve estar entre 0% e 100%", antes só "Dados inválidos."); valor recusado num campo numérico fica em vermelho com o motivo, em vez de voltar calado ao anterior; % no mapa limitado a 100%; remover fornecedor avisa quantos insumos da cotação escolhida ficam sem empresa; botão de remover com o nome do fornecedor.
- README e manual atualizados. Testes de regressão para cada correção.

## v08 — produção (2026-10-30)

- **Cotação escolhida** no mapa de cotação: cada preço tem uma caixa de seleção para escolher com qual fornecedor o insumo será contratado (um fornecedor por insumo; marcar outro troca a escolha, desmarcar tira o insumo). Assim a mesma concorrência pode ter mais de uma empresa vencedora. A nova coluna "Cotação escolhida", à direita da Melhor condição, mostra fornecedor, R$ unit., R$ total e vs. orçado de cada insumo; no rodapé, o total, quantos itens e quantas empresas, e o resultado contra a verba quando todos os insumos tiverem escolha. A escolha não muda a melhor condição, a vencedora indicada nem a aprovação, e acompanha a nova revisão.
- **Uma solicitação de contrato por empresa escolhida**: no QC aprovado com cotação escolhida, "Gerar solicitação de contrato" cria uma solicitação para cada empresa, só com os insumos escolhidos para ela (insumos sem escolha ficam de fora e são anotados nas observações). Se uma for cancelada, o botão volta e gera só a que falta. A tela do QC mostra um botão para cada solicitação ativa. Sem cotação escolhida nada muda: uma solicitação com a vencedora indicada. Cancelar uma solicitação enviada não tira a concorrência de "contratada" enquanto houver outra enviada.
- **Engenheiro e suprimentos responsáveis** em Dados do QC passam a ser digitados (não são mais escolhidos numa lista de usuários). Os QCs existentes ficam com o nome de quem estava indicado.
- A coluna **IP** (vínculo PL) saiu do mapa de cotação, porque um insumo pode ter vários vínculos. Os IPs continuam no diálogo de referências do insumo e na solicitação de contrato.
- Banco: migration `023_item_choice_owner_names.sql` (rodar no Supabase antes de liberar). Ela também troca a regra "uma solicitação ativa por concorrência" por "uma por concorrência e empresa".

## v07 — produção (2026-10-22)

- Botão **Tela cheia** no topo, no mesmo esquema da apresentação de obras (`toggleFullscreen`): o app ocupa a tela inteira; o mesmo botão (ou Esc) sai. Em telas menores aparece só o ícone, para as abas continuarem cabendo.
- Manual: tela cheia e a aba De-para no mapa das telas.

## v06 — produção (2026-10-22)

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
