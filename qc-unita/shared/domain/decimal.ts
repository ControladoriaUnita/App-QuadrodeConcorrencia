/**
 * Decimal de precisão exata baseado em BigInt.
 *
 * Regra do projeto: valores monetários e quantidades NUNCA usam float.
 * O banco usa numeric(18,4); a API trafega números como string ("1234.5600");
 * o domínio opera com Decimal. Arredondamento comercial: half-up (afasta do zero).
 */
export type DecimalInput = Decimal | string | bigint | number

const DEC_RE = /^([+-])?(\d+)(?:\.(\d+))?$/

export class Decimal {
  /** valor = units / 10^scale */
  private constructor(
    readonly units: bigint,
    readonly scale: number,
  ) {}

  static readonly ZERO = new Decimal(0n, 0)

  static from(value: DecimalInput): Decimal {
    if (value instanceof Decimal) return value
    if (typeof value === 'bigint') return new Decimal(value, 0)
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RangeError(`Número inválido: ${value}`)
      if (!Number.isSafeInteger(value)) {
        // Aceito apenas para literais; evita expoentes e ruído binário.
        return Decimal.from(value.toFixed(10).replace(/\.?0+$/, ''))
      }
      return new Decimal(BigInt(value), 0)
    }
    const s = value.trim()
    const m = DEC_RE.exec(s)
    if (!m) throw new RangeError(`Decimal inválido: "${value}"`)
    const [, sign, int, frac = ''] = m
    const units = BigInt(int! + frac) * (sign === '-' ? -1n : 1n)
    return new Decimal(units, frac.length)
  }

  /** Aceita null/undefined/'' retornando null. */
  static fromNullable(value: DecimalInput | null | undefined): Decimal | null {
    if (value === null || value === undefined || value === '') return null
    return Decimal.from(value)
  }

  /**
   * Converte entrada digitada no padrão brasileiro, sem float:
   *   "1.234,56" → 1234.56 · "1234,56" → 1234.56 · "R$ 150.000" → 150000
   *   "12,5%" → 12.5 · "-3,2" → -3.2 · "1234.56" (ponto decimal único com 1-2 casas) → 1234.56
   */
  static parseBR(input: string): Decimal {
    let s = input.trim().replace(/R\$\s?/i, '').replace(/%$/, '').replace(/\s/g, '')
    if (s === '') throw new RangeError('Valor vazio')
    const negative = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'))
    s = s.replace(/^[-+(]|\)$/g, '')
    if (s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      const dots = s.split('.').length - 1
      // "150.000" ou "1.234.567" = separador de milhar; "1234.5" ou "12.34" = decimal
      const lastGroup = s.split('.').pop() ?? ''
      if (dots > 1 || (dots === 1 && lastGroup.length === 3)) s = s.replace(/\./g, '')
    }
    if (!/^\d+(\.\d+)?$/.test(s)) throw new RangeError(`Valor inválido: "${input}"`)
    const d = Decimal.from(s)
    return negative ? d.neg() : d
  }

  // ---------------------------------------------------------------- aritmética
  private static align(a: Decimal, b: Decimal): [bigint, bigint, number] {
    const scale = Math.max(a.scale, b.scale)
    return [a.units * 10n ** BigInt(scale - a.scale), b.units * 10n ** BigInt(scale - b.scale), scale]
  }

  plus(other: DecimalInput): Decimal {
    const [a, b, scale] = Decimal.align(this, Decimal.from(other))
    return new Decimal(a + b, scale)
  }

  minus(other: DecimalInput): Decimal {
    const [a, b, scale] = Decimal.align(this, Decimal.from(other))
    return new Decimal(a - b, scale)
  }

  times(other: DecimalInput): Decimal {
    const o = Decimal.from(other)
    return new Decimal(this.units * o.units, this.scale + o.scale)
  }

  /** Divisão com arredondamento half-up na escala informada (padrão 6). */
  div(other: DecimalInput, scale = 6): Decimal {
    const o = Decimal.from(other)
    if (o.units === 0n) throw new RangeError('Divisão por zero')
    // (a/10^sa) / (b/10^sb) = a * 10^(sb + scale - sa) / b  → resultado em 10^-scale
    const exp = o.scale + scale - this.scale
    let num = this.units
    let den = o.units
    if (exp >= 0) num *= 10n ** BigInt(exp)
    else den *= 10n ** BigInt(-exp)
    return new Decimal(roundHalfUp(num, den), scale)
  }

  /** Arredonda (half-up) para a escala informada. */
  round(scale = 4): Decimal {
    if (scale >= this.scale) return new Decimal(this.units * 10n ** BigInt(scale - this.scale), scale)
    return new Decimal(roundHalfUp(this.units, 10n ** BigInt(this.scale - scale)), scale)
  }

  neg(): Decimal {
    return new Decimal(-this.units, this.scale)
  }

  abs(): Decimal {
    return this.units < 0n ? this.neg() : this
  }

  // ---------------------------------------------------------------- comparação
  compare(other: DecimalInput): -1 | 0 | 1 {
    const [a, b] = Decimal.align(this, Decimal.from(other))
    return a === b ? 0 : a < b ? -1 : 1
  }
  eq(other: DecimalInput) { return this.compare(other) === 0 }
  lt(other: DecimalInput) { return this.compare(other) < 0 }
  lte(other: DecimalInput) { return this.compare(other) <= 0 }
  gt(other: DecimalInput) { return this.compare(other) > 0 }
  gte(other: DecimalInput) { return this.compare(other) >= 0 }
  isZero() { return this.units === 0n }
  isNegative() { return this.units < 0n }
  isPositive() { return this.units > 0n }

  static sum(values: Iterable<DecimalInput>): Decimal {
    let acc = Decimal.ZERO
    for (const v of values) acc = acc.plus(v)
    return acc
  }

  static min(a: Decimal, b: Decimal) { return a.lte(b) ? a : b }
  static max(a: Decimal, b: Decimal) { return a.gte(b) ? a : b }

  // ---------------------------------------------------------------- saída
  /** String canônica com ponto decimal. Com `scale`, arredonda/expande antes. */
  toFixed(scale?: number): string {
    const d = scale === undefined ? this : this.round(scale)
    const neg = d.units < 0n
    const digits = (neg ? -d.units : d.units).toString().padStart(d.scale + 1, '0')
    const int = d.scale ? digits.slice(0, -d.scale) : digits
    const frac = d.scale ? digits.slice(-d.scale) : ''
    return `${neg ? '-' : ''}${int}${frac ? '.' + frac : ''}`
  }

  /** Formato de banco: numeric(18,4) */
  toDb(): string {
    return this.toFixed(4)
  }

  toString(): string {
    return this.toFixed()
  }

  toJSON(): string {
    return this.toFixed()
  }

  /** Apenas para gráficos/visualização. Nunca usar em cálculo. */
  toNumberUnsafe(): number {
    return Number(this.toFixed())
  }
}

function roundHalfUp(num: bigint, den: bigint): bigint {
  if (den < 0n) {
    num = -num
    den = -den
  }
  const q = num / den
  const r = num % den
  if (r === 0n) return q
  const twice = (r < 0n ? -r : r) * 2n
  if (twice >= den) return num < 0n ? q - 1n : q + 1n
  return q
}

export const D = Decimal.from
