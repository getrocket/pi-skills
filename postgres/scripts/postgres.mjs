#!/usr/bin/env node

import pg from 'pg'
import { writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { Pool } = pg

const MAX_RESULT_BYTES = 50 * 1024
const RESULTS_DIR = join(tmpdir(), 'skill-results')
const MAX_FILE_AGE_MS = 60 * 60 * 1000

// ── Helpers ─────────────────────────────────────────────────────────────────

function die(msg) {
    console.error(msg)
    process.exit(1)
}

function resolveEnvVar(base, env) {
    const suffix = env ? `_${env.toUpperCase()}` : ''
    const withSuffix = `${base}${suffix}`
    if (process.env[withSuffix]) return process.env[withSuffix]
    if (!env && process.env[`${base}_DEV`]) return process.env[`${base}_DEV`]
    if (process.env[base]) return process.env[base]
    die(`Environment variable not found. Tried: ${withSuffix}${!env ? `, ${base}_DEV, ${base}` : `, ${base}`}`)
}

function clampTimeout(ms) {
    const n = Number(ms) || 30000
    return Math.max(1000, Math.min(300000, n))
}

function cleanupOldFiles() {
    try {
        mkdirSync(RESULTS_DIR, { recursive: true })
        const now = Date.now()
        for (const f of readdirSync(RESULTS_DIR)) {
            try {
                const fp = join(RESULTS_DIR, f)
                if (now - statSync(fp).mtimeMs > MAX_FILE_AGE_MS) unlinkSync(fp)
            } catch {}
        }
    } catch {}
}

function spillToFile(toolName, data) {
    mkdirSync(RESULTS_DIR, { recursive: true })
    const fp = join(RESULTS_DIR, `${toolName}-${Date.now()}.json`)
    writeFileSync(fp, JSON.stringify(data, null, 2))
    return fp
}

function formatTable(rows) {
    if (!rows.length) return '(no rows)'
    const cols = Object.keys(rows[0])
    const header = `| ${cols.join(' | ')} |`
    const sep = `| ${cols.map(() => '---').join(' | ')} |`
    const body = rows.map((r) => `| ${cols.map((c) => String(r[c] ?? '')).join(' | ')} |`)
    return [header, sep, ...body].join('\n')
}

function output(rows, format, meta) {
    cleanupOldFiles()
    const metaLine = Object.entries(meta).map(([k, v]) => `**${k}:** ${v}`).join(' | ')
    const serialized = JSON.stringify(rows)
    const overflow = serialized.length > MAX_RESULT_BYTES

    if (format === 'json') {
        if (overflow) {
            const fp = spillToFile('postgres', rows)
            console.log(`${metaLine}\n\nResult too large (${serialized.length} bytes). Written to:\n${fp}`)
        } else {
            console.log(`${metaLine}\n\n${JSON.stringify(rows, null, 2)}`)
        }
    } else {
        const table = formatTable(rows)
        if (overflow) {
            const fp = spillToFile('postgres', rows)
            console.log(`${metaLine}\n\n${table}\n\nFull results (${rows.length} rows, ${serialized.length} bytes) written to:\n${fp}`)
        } else {
            console.log(`${metaLine}\n\n${table}`)
        }
    }
}

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const args = { _: [] }
    let i = 0
    while (i < argv.length) {
        if (argv[i].startsWith('--')) {
            const key = argv[i].slice(2)
            const next = argv[i + 1]
            if (next && !next.startsWith('--')) {
                args[key] = next
                i += 2
            } else {
                args[key] = true
                i++
            }
        } else {
            args._.push(argv[i])
            i++
        }
    }
    return args
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2))
const sql = args._[0]

if (!sql || args.help) {
    console.log(`Usage: postgres.mjs <sql> [options]

Execute read-only SQL against PostgreSQL.

Options:
  --env ENV          Environment suffix (reads POSTGRES_URL_<ENV>, default: dev)
  --format table|json  Output format (default: table)
  --timeout MS       Query timeout in ms (default: 30000, max: 300000)

Environment variables:
  POSTGRES_URL           Default connection string
  POSTGRES_URL_DEV       Dev connection string (fallback if no --env)
  POSTGRES_URL_PROD      Prod connection string (with --env prod)

Examples:
  postgres.mjs "SELECT * FROM users LIMIT 5"
  postgres.mjs "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'" --env prod
  postgres.mjs "SELECT count(*) FROM persons" --format json --timeout 60000`)
    process.exit(0)
}

const connString = resolveEnvVar('POSTGRES_URL', args.env)
const timeout = clampTimeout(args.timeout)
const format = args.format || 'table'

const pool = new Pool({
    connectionString: connString,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    max: 2
})

try {
    const client = await pool.connect()
    try {
        await client.query(`SET statement_timeout = ${timeout}`)
        const result = await client.query(sql)
        const rowCount = typeof result.rowCount === 'number' ? result.rowCount : result.rows.length
        output(result.rows, format, { Rows: rowCount, Timeout: `${timeout}ms` })
    } finally {
        try { await client.query('SET statement_timeout = DEFAULT') } catch {}
        client.release()
    }
} catch (err) {
    die(`PostgreSQL error: ${err.message}`)
} finally {
    await pool.end()
}
