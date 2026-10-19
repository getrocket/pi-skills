#!/usr/bin/env node

const TELEMETRY_API = 'https://telemetry.betterstack.com/api/v1'
const TOKEN = process.env.BETTERSTACK_API_TOKEN
const GLOBAL_TOKEN = process.env.BETTERSTACK_GLOBAL_TOKEN

const TEAM_ID = 185745
const CONN_CACHE = '/tmp/betterstack-connection.json'

class ClickHouseError extends Error {
    constructor(status, body) {
        super(`ClickHouse error (${status})`)
        this.name = 'ClickHouseError'
        this.status = status
        this.body = body
    }
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function api(path, { method = 'GET', body, token = TOKEN } = {}) {
    if (!token) {
        console.error('Error: BETTERSTACK_API_TOKEN environment variable is not set.')
        console.error('Get one from: Better Stack → API tokens → Team-based tokens')
        process.exit(1)
    }
    const opts = {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${TELEMETRY_API}${path}`, opts)
    if (!res.ok) {
        const text = await res.text()
        console.error(`API error (${res.status}): ${text}`)
        process.exit(1)
    }
    return res.json()
}

async function clickhouseQuery(sql, { host, username, password }) {
    const url = `https://${host}/?output_format_pretty_row_numbers=0`
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
        },
        body: sql
    })
    if (!res.ok) {
        const text = await res.text()
        throw new ClickHouseError(res.status, text)
    }
    return res.text()
}

function print(data) {
    console.log(JSON.stringify(data, null, 2))
}

function die(msg) {
    console.error(msg)
    process.exit(1)
}

function formatClickHouseError(error) {
    if (!(error instanceof ClickHouseError)) return String(error)
    return `ClickHouse error (${error.status}): ${error.body}`
}

function shouldFallbackToS3(error) {
    if (!(error instanceof ClickHouseError)) return false
    return /CLUSTER_DOESNT_EXIST|UNKNOWN_TABLE|UNKNOWN_DATABASE/.test(error.body)
}

function escapeSqlString(value) {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function buildSearchFilter(search) {
    if (!search) return ''
    return ` AND raw LIKE '%${escapeSqlString(search)}%'`
}

function buildLogSubquery({ sourceRef, selectFields, sinceTs, whereExtra = '', searchFilter = '' }) {
    return (
        `SELECT ${selectFields} ` +
        `FROM ${sourceRef} ` +
        `WHERE dt >= toDateTime64(${sinceTs}, 0, 'UTC')${whereExtra}${searchFilter}`
    )
}

function buildLogsSql({ tablePrefix, tableName, sinceTs, limit, search, rawOnly, mode }) {
    const selectFields = rawOnly ? 'raw' : 'dt, raw'
    const searchFilter = buildSearchFilter(search)

    const hotLogsQuery = buildLogSubquery({
        sourceRef: `remote(${tablePrefix}_${tableName}_logs)`,
        selectFields,
        sinceTs,
        searchFilter
    })

    const s3LogsQuery = buildLogSubquery({
        sourceRef: `s3Cluster(primary, ${tablePrefix}_${tableName}_s3)`,
        selectFields,
        sinceTs,
        whereExtra: ' AND _row_type = 1',
        searchFilter
    })

    let fromClause
    if (mode === 'historical') {
        fromClause = s3LogsQuery
    } else if (mode === 'hot') {
        fromClause = hotLogsQuery
    } else {
        fromClause = `${hotLogsQuery} UNION ALL ${s3LogsQuery}`
    }

    return (
        `SELECT ${selectFields} ` +
        `FROM (${fromClause}) ` +
        `ORDER BY dt DESC ` +
        `LIMIT ${limit} ` +
        `SETTINGS output_format_json_array_of_rows = 1 ` +
        `FORMAT JSONEachRow`
    )
}

async function runLogsQueryWithFallback({ conn, source, sinceTs, limit, args }) {
    const tableName = source.table_name
    const teamId = source.team_id || TEAM_ID
    const tablePrefix = `t${teamId}`

    const attempts = args.historical
        ? [
              {
                  label: 'historical S3 logs',
                  sql: buildLogsSql({
                      tablePrefix,
                      tableName,
                      sinceTs,
                      limit,
                      search: args.search,
                      rawOnly: !!args.raw,
                      mode: 'historical'
                  })
              }
          ]
        : [
              {
                  label: 'combined hot + S3 logs',
                  sql: buildLogsSql({
                      tablePrefix,
                      tableName,
                      sinceTs,
                      limit,
                      search: args.search,
                      rawOnly: !!args.raw,
                      mode: 'combined'
                  })
              },
              {
                  label: 'historical S3 logs fallback',
                  sql: buildLogsSql({
                      tablePrefix,
                      tableName,
                      sinceTs,
                      limit,
                      search: args.search,
                      rawOnly: !!args.raw,
                      mode: 'historical'
                  })
              }
          ]

    let lastError = null

    for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i]

        if (args.verbose) {
            console.error(`Log query attempt ${i + 1}/${attempts.length}: ${attempt.label}`)
            console.error('SQL:', attempt.sql)
        }

        try {
            const result = await clickhouseQuery(attempt.sql, conn)
            if (i > 0) {
                console.error(
                    `Hot log cluster unavailable for ${tableName}; using ${attempt.label}.`
                )
            }
            return result
        } catch (error) {
            lastError = error
            if (!shouldFallbackToS3(error) || i === attempts.length - 1) {
                throw error
            }
            console.error(
                `Hot log query failed for ${tableName}; retrying against S3. ${formatClickHouseError(error)}`
            )
        }
    }

    throw lastError
}

function parseLogRows(result, { rawOnly }) {
    try {
        const rows = JSON.parse(result)
        return rows.map((row) => {
            try {
                const raw = JSON.parse(row.raw)
                return rawOnly ? raw : { dt: row.dt, ...raw }
            } catch {
                return row
            }
        })
    } catch {
        return null
    }
}

async function getConnection(args, { dataRegion } = {}) {
    if (args.host && args.user && args.pass) {
        return { host: args.host, username: args.user, password: args.pass }
    }

    let conn = loadConnection()

    const needsNewConnection =
        !conn ||
        (dataRegion && conn.data_region !== dataRegion)

    if (needsNewConnection && GLOBAL_TOKEN) {
        if (conn && dataRegion && conn.data_region !== dataRegion) {
            console.error(`Cached connection is for region ${conn.data_region}, need ${dataRegion}. Reconnecting...`)
        } else {
            console.error('No cached connection. Creating one...')
        }
        await commands.connect({ team: args.team, region: dataRegion })
        conn = loadConnection()
    }

    return conn
}

// ── Connection cache ────────────────────────────────────────────────────────

const fs = await import('node:fs')

function loadConnection() {
    try {
        const data = JSON.parse(fs.readFileSync(CONN_CACHE, 'utf8'))
        // Check if expired (connections last 1 hour)
        if (data.created_at && Date.now() - data.created_at > 55 * 60 * 1000) {
            fs.unlinkSync(CONN_CACHE)
            return null
        }
        return data
    } catch {
        return null
    }
}

function saveConnection(conn) {
    conn.created_at = Date.now()
    fs.writeFileSync(CONN_CACHE, JSON.stringify(conn, null, 2))
}

// ── Source name/ID resolution ───────────────────────────────────────────────

async function resolveSource(nameOrId) {
    // If it's a number, treat as ID
    if (/^\d+$/.test(nameOrId)) {
        const data = await api(`/sources/${nameOrId}`)
        return data.data.attributes
    }
    // Otherwise search by name or table_name
    const needle = nameOrId.toLowerCase()
    let page = 1
    while (true) {
        const data = await api(`/sources?per_page=100&page=${page}`)
        for (const s of data.data) {
            const a = s.attributes
            if (
                a.name.toLowerCase() === needle ||
                a.table_name.toLowerCase() === needle ||
                a.name.toLowerCase().includes(needle) ||
                a.table_name.toLowerCase().includes(needle)
            ) {
                return { ...a, id: s.id }
            }
        }
        if (!data.pagination?.next) break
        page++
    }
    die(`Source not found: ${nameOrId}`)
}

// ── Commands ────────────────────────────────────────────────────────────────

const commands = {
    async sources(args) {
        const sources = []
        let page = 1
        const filter = args.filter?.toLowerCase()
        while (true) {
            const data = await api(`/sources?per_page=100&page=${page}`)
            for (const s of data.data) {
                const a = s.attributes
                const entry = {
                    id: s.id,
                    name: a.name,
                    table_name: a.table_name,
                    platform: a.platform,
                    team_id: a.team_id
                }
                if (filter) {
                    if (
                        a.name.toLowerCase().includes(filter) ||
                        a.table_name.toLowerCase().includes(filter)
                    ) {
                        sources.push(entry)
                    }
                } else {
                    sources.push(entry)
                }
            }
            if (!data.pagination?.next) break
            page++
        }
        print(sources)
    },

    async source(args) {
        const id = args._[0]
        if (!id) return die('Usage: betterstack.mjs source <source_id_or_name>')
        const data = await resolveSource(id)
        print(data)
    },

    async connect(args) {
        if (!GLOBAL_TOKEN) {
            return die(
                'Error: BETTERSTACK_GLOBAL_TOKEN environment variable is not set.\n' +
                    'Creating connections requires a global API token.\n' +
                    'Get one from: Better Stack → Settings → Global API tokens\n' +
                    'https://betterstack.com/settings/global-api-tokens'
            )
        }

        const teamName = args.team
        const dataRegion = args.region
        const validHours = Number(args.hours ?? 1)
        const validUntil = new Date(Date.now() + validHours * 60 * 60 * 1000).toISOString()

        const body = {
            client_type: 'clickhouse',
            valid_until: validUntil
        }
        if (dataRegion) {
            body.data_region = dataRegion
        }
        if (teamName) {
            body.team_names = [teamName]
        } else {
            body.team_ids = [TEAM_ID]
        }

        const data = await api('/connections', { method: 'POST', body, token: GLOBAL_TOKEN })
        const conn = data.data.attributes

        const cached = {
            host: conn.host,
            port: conn.port,
            username: conn.username,
            password: conn.password,
            data_region: conn.data_region,
            valid_until: conn.valid_until
        }
        saveConnection(cached)

        print({
            message: 'Connection created and cached',
            host: conn.host,
            username: conn.username,
            valid_until: conn.valid_until,
            data_region: conn.data_region,
            cache_file: CONN_CACHE
        })
    },

    async query(args) {
        const sql = args._[0] || args.sql
        if (!sql) return die('Usage: betterstack.mjs query <SQL> [--host H --user U --pass P]')

        const conn = await getConnection(args)
        if (!conn) {
            return die(
                'No connection available. Either:\n' +
                    '  1. Run: betterstack.mjs connect  (requires BETTERSTACK_GLOBAL_TOKEN)\n' +
                    '  2. Pass: --host H --user U --pass P'
            )
        }

        const result = await clickhouseQuery(sql, conn)
        console.log(result)
    },

    async logs(args) {
        const sourceName = args._[0]
        if (!sourceName) {
            return die(
                'Usage: betterstack.mjs logs <source_name_or_id> [options]\n\n' +
                    'Options:\n' +
                    '  --limit N        Max rows (default: 20)\n' +
                    '  --since DURATION How far back: 5m, 1h, 24h, 7d (default: 1h)\n' +
                    '  --search TEXT    Filter logs containing text\n' +
                    '  --historical     Query only S3 historical data\n' +
                    '  --raw            Show raw JSON column only\n' +
                    '  --verbose        Print SQL / fallback details to stderr'
            )
        }

        const source = await resolveSource(sourceName)
        const limit = Number(args.limit ?? 20)
        const since = parseDuration(args.since || '1h')
        const sinceTs = Math.floor((Date.now() - since) / 1000)

        const conn = await getConnection(args, { dataRegion: source.data_region })
        if (!conn) {
            return die('No connection available. Run: betterstack.mjs connect')
        }

        const result = await runLogsQueryWithFallback({
            conn,
            source,
            sinceTs,
            limit,
            args
        })

        const parsed = parseLogRows(result, { rawOnly: !!args.raw })
        if (parsed) {
            print(parsed)
        } else {
            console.log(result)
        }
    },

    async schema(args) {
        const sourceName = args._[0]
        if (!sourceName) return die('Usage: betterstack.mjs schema <source_name_or_id>')

        const source = await resolveSource(sourceName)
        const tableName = source.table_name
        const teamId = source.team_id || TEAM_ID
        const tablePrefix = `t${teamId}`

        const conn = await getConnection(args, { dataRegion: source.data_region })
        if (!conn) return die('No connection available. Run: betterstack.mjs connect')

        const attempts = [
            {
                label: 'hot log schema',
                sql: `DESCRIBE TABLE remote(${tablePrefix}_${tableName}_logs) FORMAT JSON`
            },
            {
                label: 'historical S3 schema fallback',
                sql: `DESCRIBE TABLE s3Cluster(primary, ${tablePrefix}_${tableName}_s3) FORMAT JSON`
            }
        ]

        let result
        for (let i = 0; i < attempts.length; i++) {
            const attempt = attempts[i]
            if (args.verbose) {
                console.error(`Schema query attempt ${i + 1}/${attempts.length}: ${attempt.label}`)
                console.error('SQL:', attempt.sql)
            }
            try {
                result = await clickhouseQuery(attempt.sql, conn)
                if (i > 0) {
                    console.error(
                        `Hot log schema unavailable for ${tableName}; using ${attempt.label}.`
                    )
                }
                break
            } catch (error) {
                if (!shouldFallbackToS3(error) || i === attempts.length - 1) {
                    throw error
                }
                console.error(
                    `Hot log schema query failed for ${tableName}; retrying against S3. ${formatClickHouseError(error)}`
                )
            }
        }

        try {
            const parsed = JSON.parse(result)
            print(parsed.data || parsed)
        } catch {
            console.log(result)
        }
    },

    async status() {
        // Quick status check - verify token works and show cached connection state
        const info = { token_set: !!TOKEN, global_token_set: !!GLOBAL_TOKEN }

        if (TOKEN) {
            try {
                const data = await api('/sources?per_page=1')
                info.api_status = 'ok'
                info.total_sources = data.data?.length >= 0 ? 'accessible' : 'unknown'
            } catch {
                info.api_status = 'error'
            }
        }

        const conn = loadConnection()
        if (conn) {
            info.connection = {
                host: conn.host,
                username: conn.username,
                valid_until: conn.valid_until,
                cached: true
            }
        } else {
            info.connection = null
        }

        print(info)
    }
}

// ── Duration parser ─────────────────────────────────────────────────────────

function parseDuration(s) {
    const match = s.match(/^(\d+)(m|h|d)$/)
    if (!match) die(`Invalid duration: ${s} (use e.g. 5m, 1h, 24h, 7d)`)
    const n = Number(match[1])
    const unit = match[2]
    const ms = { m: 60_000, h: 3_600_000, d: 86_400_000 }
    return n * ms[unit]
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

const [command, ...rest] = process.argv.slice(2)

if (!command || command === 'help' || command === '--help') {
    console.log(`Usage: betterstack.mjs <command> [options]

Commands:
  status                         Check API connection and cached credentials
  sources [--filter TEXT]        List all log sources
  source <id_or_name>            Get source details
  connect [--team NAME] [--hours N]
                                 Create a ClickHouse connection (requires BETTERSTACK_GLOBAL_TOKEN)
  query <SQL>                    Run a raw ClickHouse SQL query
  logs <source> [--limit N] [--since DURATION] [--search TEXT] [--historical] [--raw] [--verbose]
                                 Fetch logs (tries hot + S3, falls back to S3 when needed)
  schema <source> [--verbose]    Show table schema for a source

Data source tables (for raw queries):
  Recent logs:      remote(t<team_id>_<table_name>_logs)
  Historical logs:  s3Cluster(primary, t<team_id>_<table_name>_s3) WHERE _row_type = 1
  Metrics:          remote(t<team_id>_<table_name>_metrics)

Environment variables:
  BETTERSTACK_API_TOKEN          Team-scoped token (sources, status)
  BETTERSTACK_GLOBAL_TOKEN       Global token (creating connections)

Duration format: 5m, 1h, 24h, 7d

Key source IDs (Titan):
  312250  Titan Node.js    (titan_node_js)
  1560336 Titan Agent      (titan_agent)
  311972  Titan Hasura     (titan_hasura)
  311558  Titan Postgres   (titan_postgres)
  312186  Titan Client     (titan_client)`)
    process.exit(0)
}

if (!commands[command]) die(`Unknown command: ${command}\nRun with --help for usage.`)

commands[command](parseArgs(rest)).catch((error) => {
    if (error instanceof ClickHouseError) {
        console.error(formatClickHouseError(error))
        process.exit(1)
    }
    console.error(error?.stack || String(error))
    process.exit(1)
})
