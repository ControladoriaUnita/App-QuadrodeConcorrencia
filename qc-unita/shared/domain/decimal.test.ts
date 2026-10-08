import { describe, expect, it } from 'vitest'
import { Decimal, D } from './decimal'
import { formatBRL, formatPercent, formatQuantity, formatVariation } from '../format'

describe('Decimal', () => {
  it('soma sem erro binário (0,1 + 0,2 = 0,3)', () => {
    expect(D('0.1').plus('0.2').toFixed()).toBe('0.3')
  })
  it('multiplica e arredonda half-up a 4 casas', () => {
    expect(D('300.1505').times('145.79').round(4).toFixed()).toBe('43758.9414') // 43758.941395
    expect(D('0.00005').round(4).toFixed()).toBe('0.0001')
    expect(D('-0.00005').round(4).toFixed()).toBe('-0.0001')
  })
  it('divide com escala', () => {
    expect(D(1).div(3, 6).toFixed()).toBe('0.333333')
    expect(D(2).div(3, 4).toFixed()).toBe('0.6667')
    expect(() => D(1).div(0)).toThrow()
  })
  it('compara escalas diferentes', () => {
    expect(D('1.50').eq('1.5')).toBe(true)
    expect(D('10').gt('9.9999')).toBe(true)
  })
  it('suporta valores grandes de numeric(18,4)', () => {
    expect(D('99999999999999.9999').plus('0.0001').toFixed()).toBe('100000000000000.0000')
  })
  it('parseBR aceita formatos brasileiros', () => {
    expect(Decimal.parseBR('1.234,56').toFixed()).toBe('1234.56')
    expect(Decimal.parseBR('1234,56').toFixed()).toBe('1234.56')
    expect(Decimal.parseBR('R$ 150.000').toFixed()).toBe('150000')
    expect(Decimal.parseBR('R$ 1.234.567,89').toFixed()).toBe('1234567.89')
    expect(Decimal.parseBR('-3,2').toFixed()).toBe('-3.2')
    expect(Decimal.parseBR('12.5').toFixed()).toBe('12.5')
    expect(() => Decimal.parseBR('abc')).toThrow()
  })
})

describe('format pt-BR', () => {
  it('moeda', () => {
    expect(formatBRL('1234567.891')).toBe('R$ 1.234.567,89')
    expect(formatBRL('-0.004')).toBe('R$ 0,00')
    expect(formatBRL('-1500')).toBe('-R$ 1.500,00')
    expect(formatBRL(null)).toBe('—')
  })
  it('percentual e variação', () => {
    expect(formatPercent('0.123456')).toBe('12,35%')
    expect(formatVariation('0.032')).toBe('+3,2%')
    expect(formatVariation('-0.015')).toBe('-1,5%')
  })
  it('quantidade', () => {
    expect(formatQuantity('7653.9750')).toBe('7.653,975')
    expect(formatQuantity('351')).toBe('351,00')
  })
})
