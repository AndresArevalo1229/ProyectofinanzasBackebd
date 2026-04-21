import type { TransactionType } from '@prisma/client'

export interface DefaultCategoryDefinition {
  name: string
  type: TransactionType
  color: string
  icon: string
}

export const DEFAULT_CATEGORIES: DefaultCategoryDefinition[] = [
  { name: 'Sueldo', type: 'INCOME', color: '#16a34a', icon: 'wallet' },
  { name: 'Freelance', type: 'INCOME', color: '#0ea5e9', icon: 'briefcase' },
  { name: 'Regalo', type: 'INCOME', color: '#ec4899', icon: 'gift' },
  { name: 'Ahorro', type: 'INCOME', color: '#22c55e', icon: 'piggy-bank' },
  { name: 'Comida', type: 'EXPENSE', color: '#f97316', icon: 'utensils' },
  { name: 'Transporte', type: 'EXPENSE', color: '#3b82f6', icon: 'bus' },
  { name: 'Renta', type: 'EXPENSE', color: '#ef4444', icon: 'home' },
  { name: 'Servicios', type: 'EXPENSE', color: '#f59e0b', icon: 'receipt' },
  { name: 'Entretenimiento', type: 'EXPENSE', color: '#a855f7', icon: 'gamepad-2' },
  { name: 'Salud', type: 'EXPENSE', color: '#14b8a6', icon: 'heart-pulse' },
]
