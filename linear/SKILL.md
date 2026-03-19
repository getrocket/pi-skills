---
name: linear
description: Linear issue tracking via CLI. Use for creating, searching, updating, and commenting on Linear issues. Supports listing teams, workflow states, cycles, and labels. Requires LINEAR_API_KEY env var.
---

# Linear Issue Tracking

Interact with Linear for issue tracking using a bash script that wraps the Linear GraphQL API.

## Setup

Set the `LINEAR_API_KEY` environment variable with a personal API key from:
**Linear Settings → API → Personal API keys** (`https://linear.app/settings/api`)

```bash
export LINEAR_API_KEY="lin_api_..."
```

## Usage

All commands use `scripts/linear.mjs` (relative to this skill directory). No dependencies — just Node.js.

### Get current user

```bash
./scripts/linear.mjs me
```

### List teams

```bash
./scripts/linear.mjs teams
```

### Get issue details

Pass the issue identifier (e.g., `ROC-141`) directly:

```bash
./scripts/linear.mjs issue ROC-141
```

This returns title, description, state, assignee, labels, comments, and more.

### Search issues

```bash
./scripts/linear.mjs search "login bug"
./scripts/linear.mjs search "onboarding" --limit 50
```

### List issues with filters

```bash
./scripts/linear.mjs list --team ROC --state "In Progress" --limit 10
./scripts/linear.mjs list --assignee ME                    # my issues
./scripts/linear.mjs list --assignee "Jane" --state Done
```

### Create an issue

```bash
./scripts/linear.mjs create --team ROC --title "Fix login redirect" \
    --description "Users are redirected to a blank page after login" \
    --priority 2 --assignee user@example.com

# With parent issue and project
./scripts/linear.mjs create --team ROC --title "Sub-task" \
    --parent ROC-398 --project "Search"
```

Priority values: `0`=None, `1`=Urgent, `2`=High, `3`=Medium, `4`=Low

### Update an issue

```bash
./scripts/linear.mjs update ROC-141 --state "In Progress"
./scripts/linear.mjs update ROC-141 --priority 1 --assignee user@example.com
./scripts/linear.mjs update ROC-141 --title "Updated title"
./scripts/linear.mjs update ROC-141 --parent ROC-398     # Set parent issue
./scripts/linear.mjs update ROC-141 --project "Search"    # Set project
```

### Comment on an issue

```bash
./scripts/linear.mjs comment ROC-141 --body "Fixed in commit abc123"
```

### List workflow states

```bash
./scripts/linear.mjs states              # all teams
./scripts/linear.mjs states --team ROC   # specific team
```

### List labels

```bash
./scripts/linear.mjs labels              # all teams
./scripts/linear.mjs labels --team ROC
```

### List cycles

```bash
./scripts/linear.mjs cycles --team ROC
```

## Tips

- Issue identifiers like `ROC-141` are passed directly — no need to look up internal IDs.
- Use `teams` first to discover team keys if you don't know them.
- Use `states --team <KEY>` to see valid state names before updating.
- The `--assignee` flag accepts `ME` (current user) for listing, or an email address for create/update.
- All output is JSON, pipe through `jq` for further processing.
