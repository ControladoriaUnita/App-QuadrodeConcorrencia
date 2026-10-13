/**
 * Pessoa do UAU (Pessoas/ConsultarPessoasPorCondicao) → fornecedor do QC. Funções puras.
 *
 * A API do UAU não informa quem é fornecedor (não há campo nem rota de categoria e
 * subconsultas são recusadas). Decisão: fornecedor = pessoa JURÍDICA (CNPJ de 14 dígitos)
 * ATIVA (AtivoInativo = 0). Pessoas físicas ficam de fora de propósito: em boa parte são
 * clientes que compram unidades (dado pessoal, LGPD).
 */
import type { ErpSupplier } from '../erp-provider'

type Row = Record<string, unknown>

const text = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s || null
}
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const list = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((x): x is Row => !!x && typeof x === 'object') : [])

const EMAIL = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/

/** Primeiro e-mail válido do campo (o UAU às vezes traz vários separados por ; ou ,). */
export function firstValidEmail(v: unknown): string | null {
  for (const part of String(v ?? '').split(/[;,\s]+/)) {
    const e = part.trim().toLowerCase()
    if (EMAIL.test(e)) return e
  }
  return null
}

export type SkipReason = 'individual' | 'inactive' | 'invalid'

/** Mapeia uma pessoa; devolve o motivo quando ela não entra como fornecedor. */
export function mapUauPerson(row: Row): ErpSupplier | SkipReason {
  const taxId = digits(row.CpfPessoa)
  if (Number(row.TipoPessoa) !== 1) return 'individual'
  if (taxId.length !== 14) return 'invalid'
  if (Number(row.AtivoInativo) !== 0) return 'inactive'
  const legalName = text(row.NomePessoa)
  const code = Number(row.CodigoPessoa)
  if (!legalName || !Number.isFinite(code) || code <= 0) return 'invalid'

  const contactName =
    list(row.ListaDadosPessoaJuridica)
      .flatMap((j) => [text(j.ContatoPessoa), text(j.ContatoPessoa2)])
      .find((c) => !!c) ?? null
  // Endereço principal (TipoEndereco 0); senão o primeiro com cidade
  const addresses = list(row.ListaDadosPessoaEndereco)
  const address = addresses.find((a) => Number(a.TipoEndereco) === 0) ?? addresses.find((a) => text(a.CidadePessoa)) ?? null
  const uf = text(address?.UfPessoa)?.toUpperCase() ?? null

  return {
    erpId: String(code),
    legalName,
    tradeName: text(row.NomeFantasia),
    taxId,
    contactName,
    phone: null, // não vem nesta rota
    email: firstValidEmail(row.EmailPessoa),
    cndValidUntil: null, // não vem nesta rota
    city: text(address?.CidadePessoa),
    state: uf && /^[A-Z]{2}$/.test(uf) ? uf : null,
    active: true,
  }
}

export interface UauSupplierSelection {
  suppliers: ErpSupplier[]
  stats: { read: number; individual: number; inactive: number; invalid: number; duplicates: number }
}

/**
 * Filtra e mapeia as pessoas e deduplica por CNPJ (o cadastro do UAU tem CNPJs repetidos):
 * fica o registro com DataAlteracaoPessoa mais recente; empate → maior CodigoPessoa.
 */
export function selectUauSuppliers(rows: Row[]): UauSupplierSelection {
  const stats = { read: rows.length, individual: 0, inactive: 0, invalid: 0, duplicates: 0 }
  const best = new Map<string, { supplier: ErpSupplier; changedAt: number; code: number }>()
  for (const row of rows) {
    const mapped = mapUauPerson(row)
    if (typeof mapped === 'string') {
      stats[mapped]++
      continue
    }
    const changed = Date.parse(String(row.DataAlteracaoPessoa ?? ''))
    const candidate = { supplier: mapped, changedAt: Number.isNaN(changed) ? -Infinity : changed, code: Number(row.CodigoPessoa) }
    const current = best.get(mapped.taxId)
    if (current) {
      stats.duplicates++
      const newer = candidate.changedAt > current.changedAt || (candidate.changedAt === current.changedAt && candidate.code > current.code)
      if (!newer) continue
    }
    best.set(mapped.taxId, candidate)
  }
  const suppliers = [...best.values()].map((b) => b.supplier).sort((a, b) => Number(a.erpId) - Number(b.erpId))
  return { suppliers, stats }
}
