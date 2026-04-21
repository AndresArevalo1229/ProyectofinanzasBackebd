import { config as loadDotEnv } from 'dotenv'
import { spawn } from 'node:child_process'

loadDotEnv()

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Debes indicar argumentos para Prisma. Ejemplo: generate o migrate dev')
  process.exit(1)
}

const requiredEnv = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']

for (const envName of requiredEnv) {
  if (!process.env[envName] || process.env[envName].trim().length === 0) {
    console.error(`Falta la variable de entorno requerida: ${envName}`)
    process.exit(1)
  }
}

const databaseUrl = `mysql://${encodeURIComponent(process.env.MYSQL_USER)}:${encodeURIComponent(
  process.env.MYSQL_PASSWORD,
)}@${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT}/${process.env.MYSQL_DATABASE}`

const prismaCommand = spawn('prisma', args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
  },
})

prismaCommand.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
