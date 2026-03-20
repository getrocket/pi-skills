#!/usr/bin/env node

const API_URL = 'https://api.linear.app/graphql'
const API_KEY = process.env.LINEAR_API_KEY

// ── GraphQL helper ──────────────────────────────────────────────────────────

async function gql(query, variables = {}) {
    if (!API_KEY) {
        console.error('Error: LINEAR_API_KEY environment variable is not set.')
        console.error('Get one from: Linear Settings > API > Personal API keys')
        process.exit(1)
    }
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: API_KEY },
        body: JSON.stringify({ query, variables })
    })
    const json = await res.json()
    if (json.errors) {
        console.error('GraphQL errors:', JSON.stringify(json.errors, null, 2))
        process.exit(1)
    }
    return json.data
}

function print(data) {
    console.log(JSON.stringify(data, null, 2))
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function resolveTeamId(key) {
    const data = await gql(
        `query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }`,
        { key }
    )
    const id = data.teams.nodes[0]?.id
    if (!id) {
        console.error(`Error: Team '${key}' not found`)
        process.exit(1)
    }
    return id
}

async function resolveProjectId(name) {
    const data = await gql(
        `query($filter: ProjectFilter) { projects(filter: $filter) { nodes { id name } } }`,
        { filter: { name: { eq: name } } }
    )
    const id = data.projects.nodes[0]?.id
    if (!id) {
        console.error(`Error: Project '${name}' not found`)
        process.exit(1)
    }
    return id
}

async function resolveIssueId(identifier) {
    const data = await gql(`query($id: String!) { issue(id: $id) { id team { id } } }`, { id: identifier })
    if (!data.issue) {
        console.error(`Error: Issue '${identifier}' not found`)
        process.exit(1)
    }
    return data.issue
}

async function resolveUserId(email) {
    const data = await gql(
        `query($email: String!) { users(filter: { email: { eq: $email } }) { nodes { id } } }`,
        { email }
    )
    return data.users.nodes[0]?.id ?? null
}

async function resolveStateId(teamId, name) {
    const data = await gql(
        `query($filter: WorkflowStateFilter) {
            workflowStates(filter: $filter) { nodes { id } }
        }`,
        { filter: { team: { id: { eq: teamId } }, name: { eq: name } } }
    )
    return data.workflowStates.nodes[0]?.id ?? null
}

// ── Commands ────────────────────────────────────────────────────────────────

const commands = {
    async me() {
        const data = await gql('{ viewer { id name email } }')
        print(data.viewer)
    },

    async teams() {
        const data = await gql('{ teams { nodes { id name key } } }')
        print(data.teams.nodes)
    },

    async issue(args) {
        const id = args._[0]
        if (!id) return die('Usage: linear.mjs issue <ID>')

        const data = await gql(
            `query($id: String!) {
                issue(id: $id) {
                    id identifier title description priority priorityLabel
                    state { name }
                    assignee { name email }
                    labels { nodes { name } }
                    project { name }
                    cycle { name number }
                    createdAt updatedAt
                    comments { nodes { body createdAt user { name } } }
                }
            }`,
            { id }
        )
        print(data.issue)
    },

    async search(args) {
        const query = args._[0]
        if (!query) return die('Usage: linear.mjs search <query>')

        const data = await gql(
            `query($query: String!, $limit: Int) {
                searchIssues(term: $query, first: $limit) {
                    nodes { identifier title priorityLabel state { name } assignee { name } }
                }
            }`,
            { query, limit: Number(args.limit ?? 20) }
        )
        print(data.searchIssues.nodes)
    },

    async list(args) {
        const filter = {}
        if (args.team) filter.team = { key: { eq: args.team } }
        if (args.state) filter.state = { name: { eq: args.state } }
        if (args.assignee === 'ME' || args.assignee === 'me') {
            filter.assignee = { isMe: { eq: true } }
        } else if (args.assignee) {
            filter.assignee = { name: { containsIgnoreCase: args.assignee } }
        }

        const data = await gql(
            `query($filter: IssueFilter, $limit: Int) {
                issues(filter: $filter, first: $limit, orderBy: updatedAt) {
                    nodes { identifier title priorityLabel state { name } assignee { name } updatedAt }
                }
            }`,
            { filter, limit: Number(args.limit ?? 20) }
        )
        print(data.issues.nodes)
    },

    async create(args) {
        if (!args.team || !args.title) return die('Usage: linear.mjs create --team TEAM --title TITLE')

        const teamId = await resolveTeamId(args.team)
        const input = { teamId, title: args.title }

        if (args.description) input.description = args.description
        if (args.priority != null) input.priority = Number(args.priority)
        if (args.assignee) {
            const userId = await resolveUserId(args.assignee)
            if (userId) input.assigneeId = userId
        }
        if (args.parent) {
            const parent = await resolveIssueId(args.parent)
            input.parentId = parent.id
        }
        if (args.project) {
            const projectId = await resolveProjectId(args.project)
            if (projectId) input.projectId = projectId
        }

        const data = await gql(
            `mutation($input: IssueCreateInput!) {
                issueCreate(input: $input) { success issue { identifier title url } }
            }`,
            { input }
        )
        print(data.issueCreate)
    },

    async update(args) {
        const identifier = args._[0]
        if (!identifier) return die('Usage: linear.mjs update <ID> [--state STATE] [--title TITLE] ...')

        const issue = await resolveIssueId(identifier)
        const input = {}

        if (args.title) input.title = args.title
        if (args.description) input.description = args.description
        if (args.priority != null) input.priority = Number(args.priority)

        if (args.state) {
            const stateId = await resolveStateId(issue.team.id, args.state)
            if (stateId) input.stateId = stateId
            else console.error(`Warning: State '${args.state}' not found, skipping`)
        }

        if (args.assignee) {
            const userId = await resolveUserId(args.assignee)
            if (userId) input.assigneeId = userId
        }
        if (args.parent) {
            const parent = await resolveIssueId(args.parent)
            input.parentId = parent.id
        }
        if (args.project) {
            const projectId = await resolveProjectId(args.project)
            if (projectId) input.projectId = projectId
        }

        const data = await gql(
            `mutation($id: String!, $input: IssueUpdateInput!) {
                issueUpdate(id: $id, input: $input) {
                    success issue { identifier title state { name } url }
                }
            }`,
            { id: issue.id, input }
        )
        print(data.issueUpdate)
    },

    async comment(args) {
        const identifier = args._[0]
        if (!identifier || !args.body) return die('Usage: linear.mjs comment <ID> --body TEXT')

        const issue = await resolveIssueId(identifier)

        const data = await gql(
            `mutation($issueId: String!, $body: String!) {
                commentCreate(input: { issueId: $issueId, body: $body }) {
                    success comment { id body createdAt }
                }
            }`,
            { issueId: issue.id, body: args.body }
        )
        print(data.commentCreate)
    },

    async states(args) {
        const filter = args.team ? { team: { key: { eq: args.team } } } : {}
        const data = await gql(
            `query($filter: WorkflowStateFilter) {
                workflowStates(filter: $filter) { nodes { name type team { key } } }
            }`,
            { filter }
        )
        print(data.workflowStates.nodes)
    },

    async labels(args) {
        const filter = args.team ? { team: { key: { eq: args.team } } } : {}
        const data = await gql(
            `query($filter: IssueLabelFilter) {
                issueLabels(filter: $filter) { nodes { name color team { key } } }
            }`,
            { filter }
        )
        print(data.issueLabels.nodes)
    },

    async cycles(args) {
        const filter = args.team ? { team: { key: { eq: args.team } } } : {}
        const data = await gql(
            `query($filter: CycleFilter) {
                cycles(filter: $filter) { nodes { name number startsAt endsAt team { key } } }
            }`,
            { filter }
        )
        print(data.cycles.nodes)
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

function die(msg) {
    console.error(msg)
    process.exit(1)
}

// ── Main ────────────────────────────────────────────────────────────────────

const [command, ...rest] = process.argv.slice(2)

if (!command || command === 'help' || command === '--help') {
    console.log(`Usage: linear.mjs <command> [options]

Commands:
  me                             Show current authenticated user
  teams                          List all teams
  issue <ID>                     Get issue details (e.g., ROC-141)
  search <query> [--limit N]     Search issues by text
  list [--team T] [--state S] [--assignee ME|NAME] [--limit N]
  create --team T --title TITLE [--description D] [--priority 0-4] [--assignee EMAIL] [--parent ID] [--project NAME]
  update <ID> [--state S] [--title T] [--priority 0-4] [--assignee EMAIL] [--parent ID] [--project NAME]
  comment <ID> --body TEXT       Add a comment to an issue
  states [--team T]              List workflow states
  labels [--team T]              List labels
  cycles [--team T]              List cycles

Priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low`)
    process.exit(0)
}

if (!commands[command]) die(`Unknown command: ${command}\nRun with --help for usage.`)

commands[command](parseArgs(rest))
