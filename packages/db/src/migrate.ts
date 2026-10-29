import { runMigrations } from './index.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

await runMigrations(url)
console.log('migrations applied')
