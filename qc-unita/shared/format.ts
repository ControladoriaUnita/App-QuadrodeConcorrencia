/**
 * Formatação pt-BR (padrão Unità — DESIGN_SYSTEM §10), sem float para valores monetários.
 */
import { Decimal, type DecimalInput } from './domain/decimal'

export const EMPTY = '—'

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** 1234567.891 → "1.234.567,89" */
export function formatDecimal(value: DecimalInput | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || value === '') return EMPTY
  const fixed = Decimal.from(value).toFixed(fractionDigits)
  const neg = fixed.startsWith('-')
  const [int, frac] = (neg ? fixed.slice(1) : fixed).split('.')
  const body = groupThousands(int!) + (frac ? ',' + frac : '')
  return (neg && /[1-9]/.test(body) ? '-' : '') + body
}

/** "R$ 1.234.567,89" */
export function formatBRL(value: DecimalInput | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || value === '') return EMPTY
  const s = formatDecimal(value, fractionDigits)
  return s.startsWith('-') ? `-R$ ${s.slice(1)}` : `R$ ${s}`
}

/** Razão (0..1) → "12,35%". */
export function formatPercent(ratio: DecimalInput | null | undefined, fractionDigits = 2): string {
  if (ratio === null || ratio === undefined || ratio === '') return EMPTY
  return `${formatDecimal(Decimal.from(ratio).times(100), fractionDigits)}%`
}

/** Variação com sinal explícito: "+3,2%" / "-1,5%" */
export function formatVariation(ratio: DecimalInput | null | undefined, fractionDigits = 1): string {
  if (ratio === null || ratio === undefined || ratio === '') return EMPTY
  const d = Decimal.from(ratio)
  const s = formatPercent(d, fractionDigits)
  return d.isPositive() && !s.startsWith('0,0') ? `+${s}` : s
}

/** Quantidades: até 4 casas, sem zeros à direita desnecessários (mínimo 2). */
export function formatQuantity(value: DecimalInput | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY
  const s = formatDecimal(value, 4)
  return s.replace(/(,\d{2}\d*?)0+$/, '$1')
}

/** "2026-09-01" → "01/09/2026" (sem Date → sem fuso). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : EMPTY
}

/** Data e hora curtas. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return EMPTY
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d)
}

const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']
/** "2027-01-15" → "JAN/27" */
export function formatMonth(iso: string | null | undefined): string {
  if (!iso) return EMPTY
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  return m ? `${MONTHS[Number(m[2]) - 1]}/${m[1]!.slice(2)}` : EMPTY
}

/** CNPJ/CPF somente dígitos → máscara */
export function formatTaxId(digits: string | null | undefined): string {
  if (!digits) return EMPTY
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return digits
}

/** Revisão: 0 → "rev00" */
export function formatRevision(n: number): string {
  return `rev${String(n).padStart(2, '0')}`
}
