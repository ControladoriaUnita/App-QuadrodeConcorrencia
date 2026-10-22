/**
 * Arquivo de indireto de exemplo para os testes: o formato real (aba de resumo, uma aba por item,
 * cabeçalho em duas linhas, uma linha por fase, M.O.I. com CLT e PJ), com valores fictícios.
 * Os itens 16.01 e 16.05 batem com o indireto fechado da obra 2070 do modo demonstração.
 */
import type { WorkbookSheet } from '../indirect-import'

export const SUMMARY: WorkbookSheet = {
  sheet: 'Total Indiretos',
  data: [
    [null, 'PLANILHA DE CUSTO INDIRETO'],
    [null, '16.', 'TOTAL INDIRETOS'],
    [null, 'Item', 'Descrição', 'Preço Total', 'Fase 01'],
    [null, '16.01', 'EQUIPAMENTOS', 1450, 1450],
    [null, '16.05', 'MÃO DE OBRA INDIRETA - CLT', 9000],
    [null, '16.06', 'MÃO DE OBRA INDIRETA - PJ', 20000],
    [null, '16.08', 'TARIFAS', 0],
    [null, '16.09', 'LIGAÇÕES ', 500],
    [],
    [null, 'TOTAL DO INDIRETO', null, 30950],
  ],
}
export const EQUIPAMENTOS: WorkbookSheet = {
  sheet: 'Equipamentos',
  data: [
    ['EQUIPAMENTOS'],
    ['TERRAPLANAGEM 1ª Fase', null, 'FASE 01'],
    ['DESCRIÇÃO', 'COMPLEMENTOS', 'FASE', 'QUANT.', 'UN', null, null, 'COMPRA/LOCAÇÃO', 'TOTAL'],
    [null, null, null, null, null, 'Preço (Orçamentos)', 'check', null, null, new Date('2026-02-28')],
    ['FERRAMENTAS E UTILITÁRIOS', null, null, null, null, null, null, 51616],
    ['Betoneira ', '400L', 'FASE 01', 0, 'pç', 2500, 'a', 2500, 0],
    [null, null, 'FASE 02', 0, 'pç', 2500, null, 2500, 0],
    ['Carrinho de mão', '80l', 'FASE 01', 1, 'un', 650, 'a', 650, 650],
    [null, null, 'FASE 02', 1, 'un', 650, null, 650, 650],
    [null, null, 'Instaladora', 0, 'un', 650, null, 650, 0],
    ['Locação de pick-up', 'Locação De Pick-Up', 'FASE 01', 1, 'vb', 150, 'a', 150, 150],
    [null, null, null, null, null, null, null, null, null],
    [null, null, ' FASE 01', null, 'TOTAL-->>', null, null, null, 1450],
    [null, null, null, null, 'TOTAL-->> OBRA', null, null, null, 1450],
  ],
}
export const MOI: WorkbookSheet = {
  sheet: 'M.O.I.',
  data: [
    [null, null, 'FUNÇÃO', 'FASE', 'QUANT', 'UN', null, null, 'Auxilio moradia', 'SALARIO ', 'ENCARGOS', 'BENEFICOS', 'TOTAL /MÊS', 'TOTAL'],
    [],
    ['PJ', 'ADM', 'Engenheiro Pleno', 'FASE 01', 2, 'mês', 10000, 'a', 0, 9600, 0.17, 400, 10000, 20000],
    [null, 'ADM', null, 'FASE 02', 0, 'mês', 10000, null, 0, 9600, 0.17, 400, 10000, 0],
    ['CLT', 'ADM', 'Almoxarife', 'FASE 01', 2, 'mês', 4000, 'a', 0, 3600, 0.84, 400, 4000, 8000],
    ['CLT', null, 'Vale refeição (ADM)', 'FASE 01', 2, 'vb', 500, 'a', null, null, null, 500, null, 1000],
    [null, null, null, 'FASE 02', 0, 'vb', 500, null, null, null, null, 500, null, '#REF!'],
    [null, null, null, ' FASE 01', 'TOTAL-->> ', null, null, null, null, 29000],
  ],
}
export const LIGACOES: WorkbookSheet = {
  sheet: 'Ligações e Habite-se',
  data: [
    ['DESCRIÇÃO DO SERVIÇO', null, 'QUANT.', 'UN', null, null, 'CUSTO / MÊS', 'TOTAL'],
    [null, 'FASE'],
    ['TARIFA P/ LIGAÇÃO DE ÁGUA', 'FASE 01', 1, 'vb', 300, 'a', 300, 300],
    ['TARIFA P/ LIGAÇÃO DE ENERGIA/LUZ', 'FASE 01', 1, 'vb', 300, 'a', 300, 300],
    [null, ' FASE 01', null, 'TOTAL-->> ', null, null, null, 600],
  ],
}
export const WORKBOOK = [SUMMARY, EQUIPAMENTOS, MOI, LIGACOES]
