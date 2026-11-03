/**
 * O cadastro da UAU traz de tudo: em ordem alfabética o simulado pegava cartórios ("1 TABELIAO DE
 * PROTESTO...") como fornecedores. Agora prefere empresas de obra.
 */
import { describe, expect, it } from 'vitest'
import { pickSuppliers } from './simulation'

const s = (legalName: string, extra: { tradeName?: string; cndValidUntil?: string; isPlaceholder?: boolean } = {}) => ({
  legalName,
  tradeName: extra.tradeName ?? null,
  cndValidUntil: extra.cndValidUntil ?? null,
  isPlaceholder: extra.isPlaceholder,
})

describe('fornecedores do simulado', () => {
  it('prefere empresas de obra, com CND válida, sem o "Sem Fornecedor" nem nomes sem letras', () => {
    const all = [
      s('1 TABELIAO DE PROTESTO DE LETRAS'),
      s('1000 FILTROS'),
      s('Sem Fornecedor', { isPlaceholder: true }),
      s('********'),
      s('ALFA CONSTRUTORA LTDA', { cndValidUntil: '2026-10-01' }), // CND vencida
      s('ZETA ENGENHARIA LTDA'),
      s('BETA CONCRETO LTDA'),
      s('GAMA TERRAPLENAGEM LTDA', { tradeName: 'Gama' }),
    ]
    expect(pickSuppliers(all, '2026-11-03').map((x) => x.legalName)).toEqual(['BETA CONCRETO LTDA', 'GAMA TERRAPLENAGEM LTDA', 'ZETA ENGENHARIA LTDA'])
  })

  it('sem empresas de obra suficientes, completa com as demais', () => {
    expect(pickSuppliers([s('1000 FILTROS'), s('ZETA ENGENHARIA LTDA')], '2026-11-03').map((x) => x.legalName)).toEqual(['ZETA ENGENHARIA LTDA', '1000 FILTROS'])
  })
})
