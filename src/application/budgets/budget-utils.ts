import { dayjs } from '../shared/time/dayjs.js'
import { HttpError } from '../../interfaces/http/errors/http-error.js'

export type BudgetAlertLevel = 'OK' | 'WARNING' | 'EXCEEDED'

export interface BudgetProgress {
  spentAmount: number
  remainingAmount: number
  usedPercent: number
  alertLevel: BudgetAlertLevel
}

const YEAR_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

export const normalizeYearMonth = (value: string): string => {
  const normalized = value.trim()

  if (!YEAR_MONTH_REGEX.test(normalized)) {
    throw new HttpError(
      400,
      'PRESUPUESTO_PERIODO_INVALIDO',
      'yearMonth debe tener formato YYYY-MM',
    )
  }

  return normalized
}

export const resolveYearMonth = (
  yearMonth: string | undefined,
  timezone: string,
): string => {
  if (!yearMonth) {
    return dayjs().tz(timezone).format('YYYY-MM')
  }

  return normalizeYearMonth(yearMonth)
}

export const resolveYearMonthRangeUtc = (
  yearMonth: string,
  timezone: string,
): { fromUtc: Date; toUtc: Date } => {
  const startLocal = dayjs.tz(`${yearMonth}-01T00:00:00`, timezone)

  if (!startLocal.isValid()) {
    throw new HttpError(400, 'PRESUPUESTO_PERIODO_INVALIDO', 'No se pudo resolver yearMonth')
  }

  return {
    fromUtc: startLocal.utc().toDate(),
    toUtc: startLocal.endOf('month').utc().toDate(),
  }
}

export const calculateBudgetProgress = (
  limitAmount: number,
  spentAmount: number,
): BudgetProgress => {
  const usedPercentRaw = limitAmount > 0 ? (spentAmount / limitAmount) * 100 : 0
  const usedPercent = Number(usedPercentRaw.toFixed(2))
  const remainingAmount = limitAmount - spentAmount

  let alertLevel: BudgetAlertLevel = 'OK'

  if (usedPercent >= 100) {
    alertLevel = 'EXCEEDED'
  } else if (usedPercent >= 80) {
    alertLevel = 'WARNING'
  }

  return {
    spentAmount,
    remainingAmount,
    usedPercent,
    alertLevel,
  }
}
