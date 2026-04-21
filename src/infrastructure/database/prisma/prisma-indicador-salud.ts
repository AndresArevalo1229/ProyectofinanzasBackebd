import type { PrismaClient } from '@prisma/client'

import type { IndicadorSaludBaseDatosPort } from '../../../application/health/ports/indicador-salud-base-datos.port.js'

export class PrismaIndicadorSaludBaseDatos implements IndicadorSaludBaseDatosPort {
  constructor(private readonly prismaClient: PrismaClient) {}

  async verificarConexion(): Promise<boolean> {
    try {
      await this.prismaClient.$queryRaw`SELECT 1`
      return true
    } catch {
      return false
    }
  }
}
