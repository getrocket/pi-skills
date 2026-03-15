---
name: bugsnag
description: Bugsnag error tracking and monitoring. List projects, browse errors, inspect events/stacktraces, search by message, view stability trends, and manage error status. Requires BUGSNAG_AUTH_TOKEN env var.
---

# Bugsnag Error Tracking

Query errors, inspect events, and manage error status on Bugsnag using a bash script that wraps the Bugsnag REST API.

## Setup

Set `BUGSNAG_AUTH_TOKEN` with a personal auth token:

```bash
export BUGSNAG_AUTH_TOKEN="your-token"
```

Get one from: **Bugsnag → Settings → My Account → Auth Tokens**
(`https://app.bugsnag.com/settings/{org-name}/my-account/auth-tokens`)

## Usage

All commands use `scripts/bugsnag.mjs` (relative to this skill directory). No dependencies — just Node.js.

### Check status

```bash
./scripts/bugsnag.mjs status
```

### List projects

```bash
./scripts/bugsnag.mjs projects             # Uses cached project list (auto-fetches on first use)
./scripts/bugsnag.mjs projects --refresh   # Force refresh from API (e.g. after a new project is added)
```

Projects are cached at `/tmp/bugsnag-projects.json` for 24 hours. The cache is auto-populated on first use of any command that needs project resolution. Use `--refresh` to update after new projects are added in Bugsnag.

### List errors

```bash
./scripts/bugsnag.mjs errors saturn                                    # Latest errors
./scripts/bugsnag.mjs errors saturn --severity error --since 7d        # Only errors, last 7 days
./scripts/bugsnag.mjs errors saturn --status open --limit 50           # Open errors
./scripts/bugsnag.mjs errors saturn --sort events --direction desc     # By frequency
./scripts/bugsnag.mjs errors saturn --stage production                 # Production only
./scripts/bugsnag.mjs errors saturn --class TypeError                  # By error class
```

Options:
- `--limit N` — Max errors to return (default: 25)
- `--sort FIELD` — Sort by: `last_seen`, `first_seen`, `events`, `users` (default: `last_seen`)
- `--direction asc|desc` — Sort direction (default: `desc`)
- `--severity error|warning|info` — Filter by severity
- `--status open|fixed|snoozed` — Filter by status
- `--stage STAGE` — Filter by release stage (e.g., `production`)
- `--since DURATION` — Only errors with events since: `30m`, `1h`, `24h`, `7d`, `2w`
- `--search TEXT` — Filter by error message text
- `--class TEXT` — Filter by error class name

### Get error details

```bash
./scripts/bugsnag.mjs error saturn 68e6c63fd2ea886e0a348ddd
```

### List events (occurrences)

```bash
./scripts/bugsnag.mjs events saturn 68e6c63fd2ea886e0a348ddd               # Summary view
./scripts/bugsnag.mjs events saturn 68e6c63fd2ea886e0a348ddd --full        # Full reports (metaData, etc.)
./scripts/bugsnag.mjs events saturn 68e6c63fd2ea886e0a348ddd --limit 10
```

### Get full event details

```bash
./scripts/bugsnag.mjs event saturn <event_id>
```

### Search errors by message

```bash
./scripts/bugsnag.mjs search saturn "timeout"
./scripts/bugsnag.mjs search saturn "multiple person" --severity error
./scripts/bugsnag.mjs search saturn "socket" --limit 10
```

### View stability trend

```bash
./scripts/bugsnag.mjs trend saturn                              # Last 14 days
./scripts/bugsnag.mjs trend saturn --buckets 7 --resolution day # Last 7 days
./scripts/bugsnag.mjs trend saturn --resolution hour --buckets 24
```

### Manage error status

```bash
./scripts/bugsnag.mjs resolve saturn <error_id>    # Mark as fixed
./scripts/bugsnag.mjs reopen saturn <error_id>      # Reopen
./scripts/bugsnag.mjs snooze saturn <error_id>      # Snooze
./scripts/bugsnag.mjs delete saturn <error_id>      # Delete
```

## Project aliases

You can use short names instead of project IDs:

| Alias | Project |
|-------|---------|
| `saturn` / `titan` / `titan-server` | Saturn (Titan Server) |
| `titan-client` | Titan External Client |
| `titan-graphql` | titan-graphql |
| `agent-server` | agent-server |
| `astra-server` | Astra Server |
| `astra-client` | Astra Client |
| `zeus-server` / `zeus-client` | Zeus |
| `europa-server` / `europa-client` | Europa |
| `venus-server` / `venus-client` | Venus |
| `profile-service` | Profile-Service |
| `profile-saver-client` / `profile-saver-extension` | Profile Saver |

## Key project IDs

| ID | Name | Type |
|----|------|------|
| `59921997164422001ec8577e` | Saturn (Titan Server) | node |
| `5ed53a898beca8000f35d1d2` | Titan External Client | react |
| `5edf13c30c36b5000e5b9fc0` | titan-graphql | koa |
| `6977b9ca9762d7001adf951d` | agent-server | koa |
| `6757aa52d91fab0014e14423` | astra-server | node |
| `67579f98d91fab0014e143f4` | astra-client | react |

## Tips

- Project names support fuzzy matching — `saturn` matches `Saturn`, `astra` matches `astra-server`.
- Projects are cached locally (`/tmp/bugsnag-projects.json`, 24h TTL). Use `projects --refresh` after adding new projects in Bugsnag.
- Aliases are auto-generated from project names (lowercase, kebab-case, first word). Well-known aliases like `titan` → Saturn are added on top.
- Use `errors --sort events --direction desc` to find the noisiest errors.
- Use `events --full` to get metaData, breadcrumbs, request details, and user info.
- Combine filters: `errors saturn --severity error --status open --since 7d --stage production`.
- All output is JSON; pipe through `jq` for further processing.
- Duration format: `30m`, `1h`, `24h`, `7d`, `2w`.
