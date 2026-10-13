import { describe, expect, it } from 'vitest'
import { firstValidEmail, mapUauPerson, selectUauSuppliers } from './uau-suppliers'

const person = (over: Record<string, unknown> = {}) => ({
  CodigoPessoa: 10,
  NomePessoa: '  Concreto  Forte Ltda ',
  TipoPessoa: 1,
  CpfPessoa: '12.345.678/0001-90',
  AtivoInativo: 0,
  EmailPessoa: 'Comercial@Forte.example',
  NomeFantasia: 'Forte',
  DataAlteracaoPessoa: '2024-05-10T10:00:00',
  SenhaLoginPessoa: '(omitido)',
  ListaDadosPessoaJuridica: [{ ContatoPessoa: ' ', ContatoPessoa2: 'Ana' }],
  ListaDadosPessoaEndereco: [
    { TipoEndereco: 1, CidadePessoa: 'Outra', UfPessoa: 'RJ' },
    { TipoEndereco: 0, CidadePessoa: 'Goiânia', UfPessoa: 'go' },
  ],
  ...over,
})

describe('pessoa UAU → fornecedor', () => {
  it('mapeia pessoa jurídica ativa', () => {
    expect(mapUauPerson(person())).toEqual({
      erpId: '10', legalName: 'Concreto Forte Ltda', tradeName: 'Forte', taxId: '12345678000190', contactName: 'Ana',
      phone: null, email: 'comercial@forte.example', cndValidUntil: null, city: 'Goiânia', state: 'GO', active: true,
    })
  })

  it('deixa de fora pessoa física, inativa e sem CNPJ válido', () => {
    expect(mapUauPerson(person({ TipoPessoa: 0, CpfPessoa: '123.456.789-01' }))).toBe('individual')
    expect(mapUauPerson(person({ AtivoInativo: 1 }))).toBe('inactive')
    expect(mapUauPerson(person({ CpfPessoa: '123' }))).toBe('invalid')
    expect(mapUauPerson(person({ NomePessoa: '  ' }))).toBe('invalid')
  })

  it('campos opcionais ausentes viram null; UF só com 2 letras', () => {
    const s = mapUauPerson(person({ NomeFantasia: '', EmailPessoa: 'sem email', ListaDadosPessoaJuridica: null, ListaDadosPessoaEndereco: [{ TipoEndereco: 0, CidadePessoa: 'X', UfPessoa: 'Goiás' }] }))
    expect(s).toMatchObject({ tradeName: null, email: null, contactName: null, city: 'X', state: null })
  })

  it('primeiro e-mail válido de uma lista', () => {
    expect(firstValidEmail('invalido; a@b.com, c@d.com')).toBe('a@b.com')
    expect(firstValidEmail(null)).toBeNull()
  })
})

describe('seleção e deduplicação por CNPJ', () => {
  it('fica com a alteração mais recente; empate → maior código', () => {
    const { suppliers, stats } = selectUauSuppliers([
      person({ CodigoPessoa: 1, NomePessoa: 'Antigo', DataAlteracaoPessoa: '2020-01-01T00:00:00' }),
      person({ CodigoPessoa: 2, NomePessoa: 'Recente', DataAlteracaoPessoa: '2025-01-01T00:00:00' }),
      person({ CodigoPessoa: 3, NomePessoa: 'Outro', CpfPessoa: '98765432000110', DataAlteracaoPessoa: null }),
      person({ CodigoPessoa: 4, NomePessoa: 'Outro mais novo', CpfPessoa: '98765432000110', DataAlteracaoPessoa: null }),
      person({ CodigoPessoa: 5, TipoPessoa: 0, CpfPessoa: '12345678901' }),
      person({ CodigoPessoa: 6, AtivoInativo: 1, CpfPessoa: '11111111000111' }),
    ])
    expect(suppliers.map((s) => [s.erpId, s.legalName])).toEqual([['2', 'Recente'], ['4', 'Outro mais novo']])
    expect(stats).toEqual({ read: 6, individual: 1, inactive: 1, invalid: 0, duplicates: 2 })
  })
})
