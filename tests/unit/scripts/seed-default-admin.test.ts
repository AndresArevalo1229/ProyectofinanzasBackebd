import { describe, expect, it } from 'vitest'

import {
  SEED_RESET_CONFIRM_PHRASE,
  assertResetSafety,
  parseSeedCliOptions,
} from '../../../scripts/seed-default-admin.js'

describe('seed-default-admin script helpers', () => {
  describe('parseSeedCliOptions', () => {
    it('mantiene modo normal cuando no se solicita reset', () => {
      const options = parseSeedCliOptions([], undefined)

      expect(options.reset).toBe(false)
      expect(options.confirmReset).toBeNull()
    })

    it('permite reset con confirmación explícita por argumento', () => {
      const options = parseSeedCliOptions(['--reset', `--confirm=${SEED_RESET_CONFIRM_PHRASE}`], undefined)

      expect(options.reset).toBe(true)
      expect(options.confirmReset).toBe(SEED_RESET_CONFIRM_PHRASE)
    })

    it('permite reset con confirmación explícita por env', () => {
      const options = parseSeedCliOptions(['--reset'], SEED_RESET_CONFIRM_PHRASE)

      expect(options.reset).toBe(true)
      expect(options.confirmReset).toBe(SEED_RESET_CONFIRM_PHRASE)
    })

    it('rechaza reset sin confirmación explícita', () => {
      expect(() => parseSeedCliOptions(['--reset'], undefined)).toThrow(
        /Reset bloqueado/i,
      )
    })
  })

  describe('assertResetSafety', () => {
    it('acepta reset cuando todas las membresías son owner sin miembros extra', () => {
      const workspaceIds = assertResetSafety('user-1', [
        {
          workspaceId: 'w-1',
          role: 'OWNER',
          workspaceCreatedByUserId: 'user-1',
          otherActiveMembers: 0,
        },
      ])

      expect(workspaceIds).toEqual(['w-1'])
    })

    it('rechaza reset cuando hay membresía cruzada', () => {
      expect(() =>
        assertResetSafety('user-1', [
          {
            workspaceId: 'w-1',
            role: 'MEMBER',
            workspaceCreatedByUserId: 'user-2',
            otherActiveMembers: 0,
          },
        ]),
      ).toThrow(/membresías cruzadas/i)
    })

    it('rechaza reset cuando hay otros miembros activos', () => {
      expect(() =>
        assertResetSafety('user-1', [
          {
            workspaceId: 'w-1',
            role: 'OWNER',
            workspaceCreatedByUserId: 'user-1',
            otherActiveMembers: 2,
          },
        ]),
      ).toThrow(/otros miembros activos/i)
    })
  })
})
