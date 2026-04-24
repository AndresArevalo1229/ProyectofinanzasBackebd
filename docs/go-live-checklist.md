# Go-Live Checklist (Producción)

## 1) Respaldo previo obligatorio
- Ejecuta un respaldo completo de base de datos antes de cualquier limpieza.
- Guarda el respaldo fuera del servidor de aplicación.

## 2) Migraciones
- Aplica migraciones pendientes:
  - `npm run prisma:migrate:deploy`
- Verifica que las tablas de fase 5 (`Ticket`, `ShoppingItem`, `InventoryItem`) existan.

## 3) Limpieza controlada de datos de prueba
- Generar respaldo + simulación (no borra):
  - `npm run cleanup:production-data`
- Ejecución real (requiere confirmación explícita):
  - `CLEANUP_DRY_RUN=false CLEANUP_CONFIRM=YES_DELETE_TEST_DATA npm run cleanup:production-data`
- Variables opcionales de segmentación:
  - `CLEANUP_EMAIL_REGEX`
  - `CLEANUP_DISPLAY_NAME_REGEX`
  - `CLEANUP_WORKSPACE_REGEX`
  - `CLEANUP_EXCLUDE_EMAILS`
  - `CLEANUP_BACKUP_DIR`

## 4) Smoke tests backend
- `npm run test`
- `npm run test:db`
- Validar endpoints core y fase 5 con usuario real:
  - `POST/GET /tickets`
  - `POST/GET /shopping-items`
  - `POST/GET /inventory-items`
  - `GET /phase5/status`

## 5) Smoke tests frontend
- `npm test`
- `npm run build`
- Validación manual:
  - Login/registro sin datos prellenados de prueba.
  - Home con dashboard real (sin bloques demo/debug).
  - Expansión con alta/listado persistente por workspace.
