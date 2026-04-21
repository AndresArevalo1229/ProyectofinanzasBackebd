import { describe, expect, it } from 'vitest'

import {
  calculateBudgetProgress,
  normalizeYearMonth,
  resolveYearMonth,
} from '../../../../src/application/budgets/budget-utils.js'

describe('normalizeYearMonth', () => {
  it('acepta formato YYYY-MM válido', () => {
    expect(normalizeYearMonth('2026-04')).toBe('2026-04')
  })

  it('rechaza valores inválidos', () => {
    expect(() => normalizeYearMonth('2026-13')).toThrow('yearMonth debe tener formato YYYY-MM')
    expect(() => normalizeYearMonth('2026/04')).toThrow('yearMonth debe tener formato YYYY-MM')
  })
})

describe('resolveYearMonth', () => {
  it('retorna el periodo provisto cuando es válido', () => {
    expect(resolveYearMonth('2026-01', 'America/Mexico_City')).toBe('2026-01')
  })

  it('resuelve periodo actual cuando no se envía', () => {
    const resolved = resolveYearMonth(undefined, 'America/Mexico_City')
    expect(resolved).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
  })
})

describe('calculateBudgetProgress', () => {
  it('marca OK por debajo de 80%', () => {
    const progress = calculateBudgetProgress(100_000, 50_000)
    expect(progress.alertLevel).toBe('OK')
    expect(progress.usedPercent).toBe(50)
    expect(progress.remainingAmount).toBe(50_000)
  })

  it('marca WARNING desde 80% hasta <100%', () => {
    const progress = calculateBudgetProgress(100_000, 80_000)
    expect(progress.alertLevel).toBe('WARNING')
    expect(progress.usedPercent).toBe(80)
  })

  it('marca EXCEEDED en 100% o más', () => {
    const progress = calculateBudgetProgress(100_000, 120_000)
    expect(progress.alertLevel).toBe('EXCEEDED')
    expect(progress.remainingAmount).toBe(-20_000)
    expect(progress.usedPercent).toBe(120)
  })
})
