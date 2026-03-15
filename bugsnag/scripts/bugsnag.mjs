#!/usr/bin/env node

const API_BASE = 'https://api.bugsnag.com'
const TOKEN = process.env.BUGSNAG_AUTH_TOKEN
const ORG_ID = '599219838ca7e90019f9c5f7'

// ── Project cache ───────────────────────────────────────────────────────────

const PROJECTS_CACHE = '/tmp/bugsnag-projects.json'
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

const fs = await import('node:fs')

function loadProjectsCache() {
    try {
        const data = JSON.parse(fs.readFileSync(PROJECTS_CACHE, 'utf8'))
        if (data.updated_at && Date.now() - data.updated_at > CACHE_MAX_AGE_MS) {
            return null // expired
        }
        return data
    } catch {
        return null
    }
}

function saveProjectsCache(projects, aliases) {
    const data = { updated_at: Date.now(), projects, aliases }
    fs.writeFileSync(PROJECTS_CACHE, JSON.stringify(data, null, 2))
}

function buildAliasesFromProjects(projects) {
    const aliases = {}
    for (const p of projects) {
        const id = p.id
        // Exact lowercase name
        const lower = p.name.toLowerCase()
        aliases[lower] = id
        // Kebab-case version: "Titan External Client" -> "titan-external-client"
        const kebab = lower.replace(/\s+/g, '-')
        aliases[kebab] = id
        // Short segments: "Europa-V2-Prod-Server" also gets first word "europa"
        const firstWord = kebab.split('-')[0]
        if (firstWord.length > 2 && !aliases[firstWord]) {
            aliases[firstWord] = id
        }
    }
    // Add well-known convenience aliases (override auto-generated ones)
    const byName = {}
    for (const p of projects) byName[p.name.toLowerCase()] = p.id
    // "saturn" is the Titan server (Node.js backend); "titan" is the legacy JS client.
    // Map titan/titan-server to Saturn since that's what people usually mean.
    if (byName['saturn']) {
        aliases['titan'] = byName['saturn']
        aliases['titan-server'] = byName['saturn']
    }
    if (byName['titan external client']) {
        aliases['titan-client'] = byName['titan external client']
    }
    // Keep the legacy Titan JS project accessible
    if (byName['titan']) {
        aliases['titan-legacy'] = byName['titan']
        aliases['titan-js'] = byName['titan']
    }
    return aliases
}

async function fetchAndCacheProjects() {
    const projects = await api(`/organizations/${ORG_ID}/projects`)
    const list = projects.map((p) => ({ id: p.id, name: p.name, type: p.type }))
    const aliases = buildAliasesFromProjects(list)
    saveProjectsCache(list, aliases)
    return { projects: list, aliases }
}

async function getProjectAliases() {
    const cached = loadProjectsCache()
    if (cached) return cached.aliases
    const { aliases } = await fetchAndCacheProjects()
    return aliases
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function api(path, { method = 'GET', body, parseHeaders = false } = {}) {
    if (!TOKEN) {
        console.error('Error: BUGSNAG_AUTH_TOKEN environment variable is not set.')
        console.error('Get one from: https://app.bugsnag.com/settings/{org}/my-account/auth-tokens')
        process.exit(1)
    }
    const opts = {
        method,
        headers: { Authorization: `token ${TOKEN}`, 'Content-Type': 'application/json' }
    }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${API_BASE}${path}`, opts)
    if (!res.ok) {
        const text = await res.text()
        console.error(`API error (${res.status}): ${text}`)
        process.exit(1)
    }
    const text = await res.text()
    let data
    try {
        data = text ? JSON.parse(text) : {}
    } catch {
        data = { raw: text }
    }
    if (parseHeaders) {
        return { data, totalCount: res.headers.get('x-total-count'), link: res.headers.get('link') }
    }
    return data
}

function print(data) {
    console.log(JSON.stringify(data, null, 2))
}

function die(msg) {
    console.error(msg)
    process.exit(1)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function resolveProjectId(nameOrId) {
    if (!nameOrId) return null
    // If it looks like an ID (hex, 24 chars), use directly
    if (/^[0-9a-f]{24}$/.test(nameOrId)) return nameOrId

    const aliases = await getProjectAliases()
    const lower = nameOrId.toLowerCase()

    // Exact match
    if (aliases[lower]) return aliases[lower]
    // Fuzzy match
    for (const [alias, id] of Object.entries(aliases)) {
        if (alias.includes(lower)) return id
    }
    die(`Unknown project: ${nameOrId}\nRun: bugsnag.mjs projects --refresh  to update the cache and see available projects.`)
}

function parseDuration(s) {
    if (!s) return null
    const match = s.match(/^(\d+)(m|h|d|w)$/)
    if (!match) die(`Invalid duration: ${s} (use e.g. 30m, 1h, 24h, 7d, 2w)`)
    const n = Number(match[1])
    const unit = match[2]
    const ms = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
    return new Date(Date.now() - n * ms[unit]).toISOString()
}

function buildFilters(args) {
    const params = new URLSearchParams()
    if (args.severity) {
        params.append('filters[event.severity][][type]', 'eq')
        params.append('filters[event.severity][][value]', args.severity)
    }
    if (args.status) {
        params.append('filters[error.status][][type]', 'eq')
        params.append('filters[error.status][][value]', args.status)
    }
    if (args.release_stage || args.stage) {
        params.append('filters[app.release_stage][][type]', 'eq')
        params.append('filters[app.release_stage][][value]', args.release_stage || args.stage)
    }
    if (args.since) {
        const sinceDate = parseDuration(args.since)
        if (sinceDate) {
            params.append('filters[event.since][][type]', 'eq')
            params.append('filters[event.since][][value]', sinceDate)
        }
    }
    if (args.search) {
        params.append('filters[error.message][][type]', 'eq')
        params.append('filters[error.message][][value]', args.search)
    }
    if (args.class) {
        params.append('filters[error.error_class][][type]', 'eq')
        params.append('filters[error.error_class][][value]', args.class)
    }
    return params.toString()
}

function formatError(e) {
    return {
        id: e.id,
        error_class: e.error_class,
        message: e.message,
        severity: e.severity,
        status: e.status,
        events: e.events,
        users: e.users,
        first_seen: e.first_seen,
        last_seen: e.last_seen,
        release_stages: e.release_stages,
        context: e.context,
        unhandled_count: e.unthrottled_occurrence_count,
        url: e.url
    }
}

// ── Commands ────────────────────────────────────────────────────────────────

const commands = {
    async status() {
        const info = { token_set: !!TOKEN }
        if (TOKEN) {
            try {
                const orgs = await api('/user/organizations')
                info.api_status = 'ok'
                info.organizations = orgs.map((o) => ({ id: o.id, name: o.name }))
            } catch {
                info.api_status = 'error'
            }
        }
        print(info)
    },

    async projects(args) {
        const refresh = args.refresh
        if (refresh) {
            console.error('Refreshing projects cache from API...')
        }

        let cached = refresh ? null : loadProjectsCache()
        if (!cached) {
            const result = await fetchAndCacheProjects()
            cached = { projects: result.projects, aliases: result.aliases, updated_at: Date.now() }
            if (refresh) console.error(`Cached ${result.projects.length} projects to ${PROJECTS_CACHE}`)
        }

        print({
            cache_file: PROJECTS_CACHE,
            cached_at: new Date(cached.updated_at).toISOString(),
            projects: cached.projects,
            aliases: cached.aliases
        })
    },

    async errors(args) {
        const projectName = args._[0]
        if (!projectName) return die('Usage: bugsnag.mjs errors <project> [options]\n\nRun: bugsnag.mjs projects  to see available projects.')

        const projectId = await resolveProjectId(projectName)
        const limit = Number(args.limit ?? 25)
        const sort = args.sort || 'last_seen'
        const direction = args.direction || 'desc'

        const filters = buildFilters(args)
        const sep = filters ? '&' : ''
        const path = `/projects/${projectId}/errors?per_page=${limit}&sort=${sort}&direction=${direction}${sep}${filters}`

        const { data: errors, totalCount } = await api(path, { parseHeaders: true })

        const result = {
            total: Number(totalCount) || errors.length,
            showing: errors.length,
            errors: errors.map(formatError)
        }
        print(result)
    },

    async error(args) {
        const projectName = args._[0]
        const errorId = args._[1]
        if (!projectName || !errorId) return die('Usage: bugsnag.mjs error <project> <error_id>')

        const projectId = await resolveProjectId(projectName)
        const error = await api(`/projects/${projectId}/errors/${errorId}`)
        print(formatError(error))
    },

    async events(args) {
        const projectName = args._[0]
        const errorId = args._[1]
        if (!projectName || !errorId) return die('Usage: bugsnag.mjs events <project> <error_id> [--limit N] [--full]')

        const projectId = await resolveProjectId(projectName)
        const limit = Number(args.limit ?? 5)
        const full = args.full ? '&full_reports=true' : ''
        const path = `/projects/${projectId}/errors/${errorId}/events?per_page=${limit}${full}`
        const events = await api(path)

        const result = events.map((ev) => {
            const base = {
                id: ev.id,
                received_at: ev.received_at,
                severity: ev.severity,
                unhandled: ev.unhandled,
                context: ev.context,
                error_class: ev.exceptions?.[0]?.errorClass,
                message: ev.exceptions?.[0]?.message,
                stacktrace: ev.exceptions?.[0]?.stacktrace?.slice(0, 8).map((f) => ({
                    file: f.file,
                    method: f.method,
                    lineNumber: f.lineNumber,
                    columnNumber: f.columnNumber,
                    inProject: f.inProject
                }))
            }
            if (ev.app) base.app = ev.app
            if (ev.device) base.device = { hostname: ev.device.hostname, runtimeVersions: ev.device.runtimeVersions }
            if (ev.metaData) base.metaData = ev.metaData
            if (ev.request) base.request = ev.request
            if (ev.user) base.user = ev.user
            if (ev.breadcrumbs) base.breadcrumbs_count = ev.breadcrumbs.length
            return base
        })
        print(result)
    },

    async event(args) {
        const projectName = args._[0]
        const eventId = args._[1]
        if (!projectName || !eventId) return die('Usage: bugsnag.mjs event <project> <event_id>')

        const projectId = await resolveProjectId(projectName)
        const event = await api(`/projects/${projectId}/events/${eventId}`)
        print(event)
    },

    async trend(args) {
        const projectName = args._[0]
        if (!projectName) return die('Usage: bugsnag.mjs trend <project> [--buckets N] [--resolution day|hour]')

        const projectId = await resolveProjectId(projectName)
        const buckets = Number(args.buckets ?? 14)
        const resolution = args.resolution || 'day'

        const filters = buildFilters(args)
        const sep = filters ? '&' : ''
        const path = `/projects/${projectId}/stability_trend?buckets_count=${buckets}&resolution=${resolution}${sep}${filters}`
        const data = await api(path)
        print(data)
    },

    async search(args) {
        const projectName = args._[0]
        const query = args._[1] || args.query || args.q
        if (!projectName || !query) return die('Usage: bugsnag.mjs search <project> <query> [--limit N] [--severity error|warning|info]')

        const projectId = await resolveProjectId(projectName)
        const limit = Number(args.limit ?? 25)
        const sort = args.sort || 'last_seen'
        const direction = args.direction || 'desc'

        const params = new URLSearchParams()
        params.append('filters[error.message][][type]', 'eq')
        params.append('filters[error.message][][value]', query)
        if (args.severity) {
            params.append('filters[event.severity][][type]', 'eq')
            params.append('filters[event.severity][][value]', args.severity)
        }
        if (args.status) {
            params.append('filters[error.status][][type]', 'eq')
            params.append('filters[error.status][][value]', args.status)
        }

        const path = `/projects/${projectId}/errors?per_page=${limit}&sort=${sort}&direction=${direction}&${params}`
        const { data: errors, totalCount } = await api(path, { parseHeaders: true })

        print({
            query,
            total: Number(totalCount) || errors.length,
            errors: errors.map(formatError)
        })
    },

    async resolve(args) {
        const projectName = args._[0]
        const errorId = args._[1]
        if (!projectName || !errorId) return die('Usage: bugsnag.mjs resolve <project> <error_id>')

        const projectId = await resolveProjectId(projectName)
        await api(`/projects/${projectId}/errors/${errorId}`, {
            method: 'PATCH',
            body: { status: 'fixed' }
        })
        print({ message: 'Error marked as fixed', error_id: errorId })
    },

    async reopen(args) {
        const projectName = args._[0]
        const errorId = args._[1]
        if (!projectName || !errorId) return die('Usage: bugsnag.mjs reopen <project> <error_id>')

        const projectId = await resolveProjectId(projectName)
        await api(`/projects/${projectId}/errors/${errorId}`, {
            method: 'PATCH',
            body: { status: 'open' }
        })
        print({ message: 'Error reopened', error_id: errorId })
    },

    async snooze(args) {
        const projectName = args._[0]
        const errorId = args._[1]
        if (!projectName || !errorId) return die('Usage: bugsnag.mjs snooze <project> <error_id>')

        const projectId = await resolveProjectId(projectName)
        await api(`/projects/${projectId}/errors/${errorId}`, {
            method: 'PATCH',
            body: { status: 'snoozed' }
        })
        print({ message: 'Error snoozed', error_id: errorId })
    },

    async delete(args) {
        const projectName = args._[0]
        const errorId = args._[1]
        if (!projectName || !errorId) return die('Usage: bugsnag.mjs delete <project> <error_id>')

        const projectId = await resolveProjectId(projectName)
        await api(`/projects/${projectId}/errors/${errorId}`, { method: 'DELETE' })
        print({ message: 'Error deleted', error_id: errorId })
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

const [command, ...rest] = process.argv.slice(2)

if (!command || command === 'help' || command === '--help') {
    console.log(`Usage: bugsnag.mjs <command> [options]

Commands:
  status                         Check API connection
  projects [--refresh]           List all projects (cached; --refresh to update from API)

  errors <project> [options]     List errors for a project
    --limit N                    Max errors to return (default: 25)
    --sort FIELD                 Sort by: last_seen, first_seen, events, users (default: last_seen)
    --direction asc|desc         Sort direction (default: desc)
    --severity error|warning|info  Filter by severity
    --status open|fixed|snoozed  Filter by status
    --stage STAGE                Filter by release stage (e.g. production)
    --since DURATION             Only errors with events since: 30m, 1h, 24h, 7d, 2w
    --search TEXT                Filter by error message
    --class TEXT                 Filter by error class

  error <project> <error_id>     Get details for a specific error
  events <project> <error_id>    List events (occurrences) for an error
    --limit N                    Max events (default: 5)
    --full                       Include full reports (metaData, breadcrumbs, etc.)
  event <project> <event_id>     Get full details for a specific event

  search <project> <query>       Search errors by message
    --limit N                    Max results (default: 25)
    --severity error|warning|info

  trend <project>                Get stability trend data
    --buckets N                  Number of time buckets (default: 14)
    --resolution day|hour        Bucket resolution (default: day)

  resolve <project> <error_id>   Mark error as fixed
  reopen <project> <error_id>    Reopen a resolved error
  snooze <project> <error_id>    Snooze an error
  delete <project> <error_id>    Delete an error

Project aliases (shortcuts):
  saturn, titan, titan-server    → Saturn (Titan Server)
  titan-client                   → Titan External Client
  titan-graphql                  → titan-graphql
  agent-server                   → agent-server
  astra-server, astra-client     → Astra
  zeus-server, zeus-client       → Zeus
  europa-server, europa-client   → Europa
  venus-server, venus-client     → Venus

Environment variables:
  BUGSNAG_AUTH_TOKEN             Personal auth token (required)`)
    process.exit(0)
}

if (!commands[command]) die(`Unknown command: ${command}\nRun with --help for usage.`)

commands[command](parseArgs(rest))
