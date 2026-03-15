#!/usr/bin/env node

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
    console.log(`Usage: graphql.mjs <query> [options]

Execute a GraphQL query against the configured endpoint.

Options:
  --env ENV              Environment suffix (reads GRAPHQL_URL_<ENV>, default: dev)
  --variables JSON       Query variables as JSON string
  --operation NAME       Operation name (if document has multiple operations)
  --headers JSON         Extra headers as JSON string (merged with GRAPHQL_HEADERS_<ENV>)
  --timeout MS           Request timeout in ms (default: 30000, max: 300000)

Environment variables:
  GRAPHQL_URL             Default endpoint
  GRAPHQL_URL_DEV         Dev endpoint (fallback if no --env)
  GRAPHQL_URL_PROD        Prod endpoint (with --env prod)
  GRAPHQL_HEADERS         Default headers as JSON (e.g. '{"x-hasura-admin-secret": "..."}')
  GRAPHQL_HEADERS_DEV     Dev headers
  GRAPHQL_HEADERS_PROD    Prod headers

Examples:
  graphql.mjs "query { users(limit: 5) { id name } }"
  graphql.mjs "query GetUser(\\$id: uuid!) { users_by_pk(id: \\$id) { id name } }" --variables '{"id": "abc"}'
  graphql.mjs "query { persons_aggregate { aggregate { count } } }" --env prod`)
    process.exit(0)
}

const endpoint = resolveEnvVar('GRAPHQL_URL', args.env)
const timeout = clampTimeout(args.timeout)

// Build headers
let baseHeaders = {}
const headersEnvSuffix = args.env ? `_${args.env.toUpperCase()}` : ''
const headersEnv = process.env[`GRAPHQL_HEADERS${headersEnvSuffix}`] || process.env.GRAPHQL_HEADERS_DEV || process.env.GRAPHQL_HEADERS || ''
if (headersEnv) {
    try { baseHeaders = JSON.parse(headersEnv) } catch { die('Failed to parse GRAPHQL_HEADERS as JSON') }
}
let extraHeaders = {}
if (args.headers) {
    try { extraHeaders = JSON.parse(args.headers) } catch { die('Failed to parse --headers as JSON') }
}

let variables
if (args.variables) {
    try { variables = JSON.parse(args.variables) } catch { die('Failed to parse --variables as JSON') }
}

const headers = {
    'Content-Type': 'application/json',
    ...baseHeaders,
    ...extraHeaders
}

const body = JSON.stringify({
    query,
    operationName: args.operation || undefined,
    variables
})

const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), timeout)

try {
    const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal
    })

    const text = await res.text()
    let payload
    try { payload = JSON.parse(text) } catch { die(`Unable to parse response as JSON: ${text.slice(0, 200)}`) }

    if (!res.ok) {
        die(`GraphQL request failed (${res.status}): ${res.statusText}\n${JSON.stringify(payload, null, 2)}`)
    }

    cleanupOldFiles()

    const hasErrors = Array.isArray(payload.errors) && payload.errors.length > 0
    const result = JSON.stringify(payload, null, 2)

    if (result.length > MAX_RESULT_BYTES) {
        const fp = spillToFile('graphql', payload)
        const summary = hasErrors ? `Errors: ${payload.errors.length} | ` : ''
        console.log(`${summary}Result too large (${result.length} bytes). Written to:\n${fp}`)
    } else {
        if (hasErrors) {
            console.error(`GraphQL returned ${payload.errors.length} error(s)`)
        }
        console.log(result)
    }

    if (hasErrors) process.exit(1)
} catch (err) {
    if (err.name === 'AbortError') die(`GraphQL request timed out after ${timeout}ms`)
    die(`GraphQL error: ${err.message}`)
} finally {
    clearTimeout(timer)
}
