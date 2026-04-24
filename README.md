# Back Finanzas (API v1)

Backend en Node.js 22 + TypeScript + Fastify + Prisma (MySQL) con estructura Clean Architecture.

## Requisitos

- Node.js `>=22`
- MySQL accesible

## Configuración

1. Crear `.env` desde `.env.example`.
2. Ajustar credenciales `MYSQL_*`, secretos JWT y puertos.
3. Configurar `AUTH_EXPOSE_PASSWORD_RESET_TOKEN=false` en producción.

## Comandos

- `npm run dev`: servidor en modo desarrollo.
- `npm run build`: compila TypeScript a `dist/`.
- `npm run start`: ejecuta build en producción.
- `npm run lint`: reglas estáticas.
- `npm run test`: suite de pruebas.
- `npm run test:db`: integración real contra MySQL.
- `npm run seed:default`: crea usuario admin + workspace inicial por defecto (idempotente).
- `npm run seed:reset-admin`: reset seguro del admin seed (requiere confirmación explícita).
- `npm run cleanup:production-data`: respaldo + limpieza controlada de datos de prueba (por defecto en `dry-run`).
- `npm run prisma:generate`: genera cliente Prisma.
- `npm run prisma:migrate:dev -- --name <nombre>`: crea/aplica migración local.
- `npm run prisma:migrate:deploy`: aplica migraciones pendientes.

### Seed admin: modo normal vs reset

- Modo normal (`seed:default`): si el admin ya existe, no toca datos.
- Modo reset (`seed:reset-admin`): borra y recrea el admin solo si es seguro.
  - Requiere confirmación explícita (`YES_RESET_ADMIN`).
  - Aborta si detecta otros miembros activos en workspaces del admin.
  - Aborta si detecta membresías cruzadas/no-owner del admin.

## Endpoints clave v1

- Health: `GET /api/v1/health`
- Docs OpenAPI: `GET /docs`
- Auth:
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
  - `POST /api/v1/auth/logout`
  - `POST /api/v1/auth/password/forgot`
  - `POST /api/v1/auth/password/reset`
- Workspaces:
  - `POST /api/v1/workspaces`
  - `GET /api/v1/workspaces`
  - `GET /api/v1/workspaces/current`
  - `POST /api/v1/workspaces/:workspaceId/invites`
  - `POST /api/v1/workspaces/join`
  - `GET /api/v1/workspaces/:workspaceId/members`
  - `PATCH /api/v1/workspaces/:workspaceId/settings`
- Finanzas:
  - `POST/GET/PATCH/DELETE /api/v1/accounts`
  - `POST/GET/PATCH/DELETE /api/v1/categories`
  - `POST/GET/PATCH/DELETE /api/v1/transactions`
  - `POST/GET /api/v1/transfers`
- Metas:
  - `POST/GET/PATCH/DELETE /api/v1/goals`
  - `POST/GET /api/v1/goals/:goalId/contributions`
- Presupuestos:
  - `POST/GET/PATCH/DELETE /api/v1/budgets`
  - `GET /api/v1/budgets/summary`
- Reportes:
  - `GET /api/v1/dashboard/summary`
  - `GET /api/v1/reports/by-category`
  - `GET /api/v1/reports/cashflow`
- Expansión (fase 5):
  - `GET /api/v1/phase5/status`
  - `GET /api/v1/tickets`
  - `POST /api/v1/tickets`
  - `GET /api/v1/shopping-items`
  - `POST /api/v1/shopping-items`
  - `GET /api/v1/inventory-items`
  - `POST /api/v1/inventory-items`

## Contrato HTTP estándar

- Éxito:
  - `{ exito: true, mensaje, datos, meta: { requestId }, error: null }`
  - En transacciones `EXPENSE`, `meta.alertasPresupuesto` aparece cuando el gasto queda en `WARNING` o `EXCEEDED`.
- Error:
  - `{ exito: false, mensaje, datos: null, meta: { requestId }, error: { codigo, detalles } }`

## Docker (VPS)

- Build y run:
  - `docker compose up -d --build`
- Requiere archivo `.env` con `MYSQL_*`, JWT y demás variables.
- El contenedor aplica migraciones en arranque con `prisma:migrate:deploy`.

## Pruebas de integración MySQL real

- Se activan con: `RUN_DB_INTEGRATION=1 npm run test`
- CI ya las ejecuta con servicio MySQL en GitHub Actions.

## Go-Live

- Checklist de despliegue y limpieza: `docs/go-live-checklist.md`.
