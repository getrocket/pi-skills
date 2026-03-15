#!/usr/bin/env node

import { createRequire } from 'node:module'

// Resolve BigQuery - prefer newer version from agent workspace if available
let BigQuery
try {
    const require = createRequire(import.meta.url)
    const mod = require('@google-cloud/bigquery')
    BigQuery = mod.BigQuery || mod.default?.BigQuery
    if (!BigQuery) throw new Error('BigQuery constructor not found')
} catch {
    // Try agent workspace which has a newer version
    try {
        const require = createRequire('/workspace/agent/package.json')
        const mod = require('@google-cloud/bigquery')
        BigQuery = mod.BigQuery
    } catch (e) {
        console.error('Could not load @google-cloud/bigquery. Install it: npm install @google-cloud/bigquery')
        process.exit(1)
    }
}
import { writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MAX_RESULT_BYTES = 50 * 1024
const RESULTS_DIR = join(tmpdir(), 'skill-results')
const MAX_FILE_AGE_MS = 60 * 60 * 1000
const MAX_BYTES_BILLED = 10 * 1024 * 1024 * 1024 // 10 GB safety cap

// ── Helpers ─────────────────────────────────────────────────────────────────

function die(msg) {
    console.error(msg)
    process.exit(1)
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

function output(rows, bytesProcessed, format, meta) {
    cleanupOldFiles()
    const metaLine = Object.entries(meta).map(([k, v]) => `**${k}:** ${v}`).join(' | ')
    const serialized = JSON.stringify(rows)
    const overflow = serialized.length > MAX_RESULT_BYTES

    if (format === 'json') {
        const payload = { rows, bytesProcessed }
        if (overflow) {
            const fp = spillToFile('bigquery', payload)
            console.log(`${metaLine}\n\nResult too large (${serialized.length} bytes). Written to:\n${fp}`)
        } else {
            console.log(`${metaLine}\n\n${JSON.stringify(payload, null, 2)}`)
        }
    } else {
        const table = formatTable(rows)
        if (overflow) {
            const fp = spillToFile('bigquery', { rows, bytesProcessed })
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

// ── Credentials ─────────────────────────────────────────────────────────────

function loadCredentials(env) {
    const suffix = env ? `_${env.toUpperCase()}` : ''
    const candidates = [
        `GOOGLE_APPLICATION_CREDENTIALS${suffix}`,
        ...(!env ? ['GOOGLE_APPLICATION_CREDENTIALS_DEV', 'GOOGLE_APPLICATION_CREDENTIALS'] : ['GOOGLE_APPLICATION_CREDENTIALS'])
    ]

    for (const name of candidates) {
        const val = process.env[name]
        if (!val) continue
        const trimmed = val.trim()
        if (trimmed.startsWith('{')) {
            try { return { credentials: JSON.parse(trimmed) } } catch { die(`${name} looks like JSON but failed to parse`) }
        }
        return { keyFilename: trimmed }
    }

    die(`No credentials found. Tried: ${[...new Set(candidates)].join(', ')}`)
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2))
const query = args._[0]

if (!query || args.help) {
    console.log(`Usage: bigquery.mjs <query> [options]

Execute read-only SQL against Google BigQuery.

Options:
  --env ENV              Environment suffix (reads GOOGLE_APPLICATION_CREDENTIALS_<ENV>)
  --format table|json    Output format (default: table)
  --timeout MS           Query timeout in ms (default: 30000, max: 300000)

Environment variables:
  GOOGLE_APPLICATION_CREDENTIALS       Path to service account JSON or inline JSON
  GOOGLE_APPLICATION_CREDENTIALS_DEV   Dev credentials (fallback if no --env)
  GOOGLE_APPLICATION_CREDENTIALS_PROD  Prod credentials (with --env prod)

Examples:
  bigquery.mjs "SELECT * FROM \\\`project.dataset.table\\\` LIMIT 10"
  bigquery.mjs "SELECT table_id, row_count FROM \\\`project.dataset.__TABLES__\\\`"
  bigquery.mjs "SELECT column_name, data_type FROM \\\`project.dataset.INFORMATION_SCHEMA.COLUMNS\\\` WHERE table_name = 'my_table'" --format json`)
    process.exit(0)
}

const creds = loadCredentials(args.env)
const timeout = clampTimeout(args.timeout)
const format = args.format || 'table'

const bq = new BigQuery(creds)

try {
    const [job] = await bq.createQueryJob({
        query,
        useLegacySql: false,
        jobTimeoutMs: timeout,
        maximumBytesBilled: String(MAX_BYTES_BILLED)
    })

    const [rows] = await job.getQueryResults()
    const [meta] = await job.getMetadata()
    const bytesProcessed = Number(meta?.statistics?.totalBytesProcessed || 0)

    output(rows, bytesProcessed, format, {
        Rows: rows.length,
        Timeout: `${timeout}ms`,
        'Bytes processed': bytesProcessed
    })
} catch (err) {
    die(`BigQuery error: ${err.message}`)
}
