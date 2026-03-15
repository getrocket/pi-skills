#!/usr/bin/env node

import { createClient } from '@clickhouse/client'
import { writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

function output(rows, stats, format, meta) {
    cleanupOldFiles()
    const metaLine = Object.entries(meta).map(([k, v]) => `**${k}:** ${v}`).join(' | ')
    const serialized = JSON.stringify(rows)
    const overflow = serialized.length > MAX_RESULT_BYTES

    if (format === 'json') {
        const payload = { data: rows, statistics: stats }
        if (overflow) {
            const fp = spillToFile('clickhouse', payload)
            console.log(`${metaLine}\n\nResult too large (${serialized.length} bytes). Written to:\n${fp}`)
        } else {
            console.log(`${metaLine}\n\n${JSON.stringify(payload, null, 2)}`)
        }
    } else {
        const table = formatTable(rows)
        if (overflow) {
            const fp = spillToFile('clickhouse', { data: rows, statistics: stats })
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
const query = args._[0]

if (!query || args.help) {
    console.log(`Usage: clickhouse.mjs <query> [options]

Execute a ClickHouse SQL query.

Options:
  --env ENV              Environment suffix (reads CLICKHOUSE_URL_<ENV>, default: dev)
  --format table|json    Output format (default: table)
  --ch-format FMT        ClickHouse output format: JSON, JSONEachRow, JSONCompact (default: JSON)
  --timeout MS           Query timeout in ms (default: 30000, max: 300000)

Environment variables:
  CLICKHOUSE_URL          Default connection URL
  CLICKHOUSE_URL_DEV      Dev connection URL (fallback if no --env)
  CLICKHOUSE_URL_PROD     Prod connection URL (with --env prod)

Examples:
  clickhouse.mjs "SELECT count() FROM system.tables"
  clickhouse.mjs "SELECT * FROM inferences LIMIT 10" --env prod
  clickhouse.mjs "SELECT database, name FROM system.tables" --format json`)
    process.exit(0)
}

const url = resolveEnvVar('CLICKHOUSE_URL', args.env)
const timeout = clampTimeout(args.timeout)
const format = args.format || 'table'
const chFormat = args['ch-format'] || 'JSON'

const client = createClient({
    url,
    request_timeout: timeout
})

try {
    const resultSet = await client.query({
        query,
        format: chFormat,
        clickhouse_settings: {
            max_execution_time: Math.floor(timeout / 1000)
        }
    })

    const jsonResult = await resultSet.json()

    let data, statistics
    if (Array.isArray(jsonResult)) {
        data = jsonResult
        statistics = { elapsed: 0, rows_read: 0, bytes_read: 0 }
    } else {
        data = jsonResult.data || []
        statistics = jsonResult.statistics || { elapsed: 0, rows_read: 0, bytes_read: 0 }
    }

    output(data, statistics, format, {
        Rows: data.length,
        Timeout: `${timeout}ms`,
        'Rows read': statistics.rows_read,
        'Bytes read': statistics.bytes_read,
        Elapsed: `${statistics.elapsed}s`
    })
} catch (err) {
    die(`ClickHouse error: ${err.message}`)
} finally {
    await client.close()
}
