# pi-skills

A collection of skills for [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent), compatible with Claude Code, Codex CLI, Amp, and Droid.

Forked from [badlogic/pi-skills](https://github.com/badlogic/pi-skills) with additional skills for Rocket/Titan infrastructure.

## Installation

### pi-coding-agent

```bash
# User-level (available in all projects)
git clone https://github.com/getrocket/pi-skills ~/.pi/agent/skills/pi-skills

# Or project-level
git clone https://github.com/getrocket/pi-skills .pi/skills/pi-skills
```

### Codex CLI

```bash
git clone https://github.com/getrocket/pi-skills ~/.codex/skills/pi-skills
```

### Amp

Amp finds skills recursively in toolboxes:

```bash
git clone https://github.com/getrocket/pi-skills ~/.config/amp/tools/pi-skills
```

### Droid (Factory)

```bash
# User-level
git clone https://github.com/getrocket/pi-skills ~/.factory/skills/pi-skills

# Or project-level
git clone https://github.com/getrocket/pi-skills .factory/skills/pi-skills
```

### Claude Code

Claude Code only looks one level deep for `SKILL.md` files, so each skill folder must be directly under the skills directory. Clone the repo somewhere, then symlink individual skills:

```bash
# Clone to a convenient location
git clone https://github.com/getrocket/pi-skills ~/pi-skills

# Symlink individual skills (user-level)
mkdir -p ~/.claude/skills
for skill in ~/pi-skills/*/; do
  [ -f "$skill/SKILL.md" ] && ln -sf "$skill" ~/.claude/skills/$(basename "$skill")
done
```

## Available Skills

### General

| Skill | Description |
|-------|-------------|
| [brave-search](brave-search/SKILL.md) | Web search and content extraction via Brave Search |
| [browser-tools](browser-tools/SKILL.md) | Interactive browser automation via Chrome DevTools Protocol |
| [gccli](gccli/SKILL.md) | Google Calendar CLI for events and availability |
| [gdcli](gdcli/SKILL.md) | Google Drive CLI for file management and sharing |
| [gmcli](gmcli/SKILL.md) | Gmail CLI for email, drafts, and labels |
| [transcribe](transcribe/SKILL.md) | Speech-to-text transcription via Groq Whisper API |
| [vscode](vscode/SKILL.md) | VS Code integration for diffs and file comparison |
| [youtube-transcript](youtube-transcript/SKILL.md) | Fetch YouTube video transcripts |

### Infrastructure & Observability

| Skill | Description |
|-------|-------------|
| [betterstack](betterstack/SKILL.md) | BetterStack log querying, source management, and ClickHouse queries |
| [bugsnag](bugsnag/SKILL.md) | Bugsnag error tracking — browse errors, inspect events, manage status |
| [linear](linear/SKILL.md) | Linear issue tracking — create, search, update, and comment on issues |

### Database & API

| Skill | Description |
|-------|-------------|
| [bigquery](bigquery/SKILL.md) | Google BigQuery SQL queries |
| [clickhouse](clickhouse/SKILL.md) | ClickHouse SQL queries |
| [graphql](graphql/SKILL.md) | GraphQL queries (Hasura) |
| [postgres](postgres/SKILL.md) | PostgreSQL queries |

## Skill Format

Each skill follows the pi/Claude Code format:

```markdown
---
name: skill-name
description: Short description shown to agent
---

# Instructions

Detailed instructions here...
Helper files available at: {baseDir}/
```

The `{baseDir}` placeholder is replaced with the skill's directory path at runtime.

## Requirements

Some skills require additional setup. Generally, the agent will walk you through that. But if not, here you go:

- **brave-search**: Requires `BRAVE_API_KEY`. Run `npm install` in the skill directory.
- **browser-tools**: Chrome running on host with `--remote-debugging-port=9222`. Run `npm install` in the skill directory.
- **gccli**: Install globally with `npm install -g @mariozechner/gccli`.
- **gdcli**: Install globally with `npm install -g @mariozechner/gdcli`.
- **gmcli**: Install globally with `npm install -g @mariozechner/gmcli`.
- **transcribe**: Requires curl and `GROQ_API_KEY`.
- **vscode**: Requires VS Code with `code` CLI in PATH.
- **youtube-transcript**: Run `npm install` in the skill directory.
- **betterstack**: Requires `BETTERSTACK_API_TOKEN` and optionally `BETTERSTACK_GLOBAL_TOKEN`.
- **bugsnag**: Requires `BUGSNAG_AUTH_TOKEN`.
- **linear**: Requires `LINEAR_API_KEY`.
- **bigquery**: Requires `GOOGLE_APPLICATION_CREDENTIALS`.
- **clickhouse**: Requires `CLICKHOUSE_URL`.
- **graphql**: Requires `GRAPHQL_ENDPOINT`.
- **postgres**: Requires `POSTGRES_CONNECTION_STRING`.

## Syncing with upstream

```bash
git remote add upstream https://github.com/badlogic/pi-skills
git fetch upstream
git merge upstream/main
```

## License

MIT
