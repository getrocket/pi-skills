---
name: betterstack
description: BetterStack log querying and source management. Fetch logs by source, run ClickHouse queries, and list telemetry sources. Requires BETTERSTACK_API_TOKEN env var; BETTERSTACK_GLOBAL_TOKEN needed for creating ClickHouse connections.
---

# BetterStack Telemetry

Query logs, list sources, and run ClickHouse queries against BetterStack Telemetry using a bash script that wraps the BetterStack REST and SQL APIs.

## Setup

### Required: Team-scoped API token

Set `BETTERSTACK_API_TOKEN` for listing sources and basic operations:

```bash
export BETTERSTACK_API_TOKEN="your-team-token"
```

Get one from: **Better Stack → Settings → API tokens → Team-based tokens**
(`https://betterstack.com/settings/api-tokens/0`)

### Optional: Global API token (for log queries)

Set `BETTERSTACK_GLOBAL_TOKEN` to enable creating ClickHouse connections for querying logs:

```bash
export BETTERSTACK_GLOBAL_TOKEN="your-global-token"
```

Get one from: **Better Stack → Settings → Global API tokens**
(`https://betterstack.com/settings/global-api-tokens`)

## Usage

All commands use `scripts/betterstack.mjs` (relative to this skill directory). No dependencies — just Node.js.

### Check status

```bash
./scripts/betterstack.mjs status
```

### List sources

```bash
./scripts/betterstack.mjs sources
./scripts/betterstack.mjs sources --filter titan    # Filter by name
```

### Get source details

```bash
./scripts/betterstack.mjs source 312250             # By ID
./scripts/betterstack.mjs source "Titan Node.js"    # By name (fuzzy match)
./scripts/betterstack.mjs source titan_node_js       # By table_name
```

### Create a ClickHouse connection

Creates temporary credentials (cached for ~1 hour). Required before running queries.

```bash
./scripts/betterstack.mjs connect                    # Default 1-hour connection
./scripts/betterstack.mjs connect --hours 2          # 2-hour connection
```

### Fetch logs (convenience command)

```bash
./scripts/betterstack.mjs logs titan_node_js                          # Last 1h, 20 rows
./scripts/betterstack.mjs logs titan_node_js --limit 50 --since 24h   # Last 24h, 50 rows
./scripts/betterstack.mjs logs titan_node_js --search "error"          # Filter by text
./scripts/betterstack.mjs logs titan_node_js --historical --since 7d   # Query S3 cold storage
./scripts/betterstack.mjs logs titan_node_js --raw                     # Raw JSON only
./scripts/betterstack.mjs logs titan_node_js --verbose                 # Show generated SQL
```

Options:
- `--limit N` — Max rows (default: 20)
- `--since DURATION` — How far back: `5m`, `1h`, `24h`, `7d` (default: `1h`)
- `--search TEXT` — Filter logs containing text
- `--historical` — Query cold (S3) storage instead of hot storage
- `--raw` — Show only the raw JSON column
- `--verbose` — Print the generated SQL to stderr

### Run raw ClickHouse queries

```bash
./scripts/betterstack.mjs query "SELECT count() FROM remote(t185745_titan_node_js_logs) WHERE dt >= now() - INTERVAL 1 HOUR FORMAT JSON"
```

### Show table schema

```bash
./scripts/betterstack.mjs schema titan_node_js
```

## Data source table names

For raw queries, use these table name patterns:

| Data type | Table reference | Notes |
|-----------|----------------|-------|
| Recent logs (hot) | `remote(t<team_id>_<table>_logs)` | Fast, last ~30 min |
| Historical logs (cold) | `s3Cluster(primary, t<team_id>_<table>_s3)` | Add `WHERE _row_type = 1` |
| Spans | `remote(t<team_id>_<table>_spans)` | Or S3 with `_row_type = 3` |
| Metrics | `remote(t<team_id>_<table>_metrics)` | Aggregated data |

Team ID: `185745`

## Key sources

| ID | Name | Table name |
|----|------|------------|
| 312250 | Titan Node.js | `titan_node_js` |
| 1560336 | Titan Agent | `titan_agent` |
| 311972 | Titan Hasura | `titan_hasura` |
| 311558 | Titan Postgres | `titan_postgres` |
| 312186 | Titan Client | `titan_client` |
| 318511 | Titan Client Nginx | `titan_client_nginx` |
| 318619 | Titan Node Nginx | `titan_node_nginx` |

## Tips

- Connection credentials are cached at `/tmp/betterstack-connection.json` and auto-expire after ~55 minutes.
- The `logs` and `query` commands auto-create a connection if `BETTERSTACK_GLOBAL_TOKEN` is set.
- Source names support fuzzy matching — `titan_node` will match `Titan Node.js`.
- For JSON field extraction in raw queries: `JSONExtract(raw, 'field', 'Nullable(String)')`.
- Always use `LIMIT` to avoid memory issues on large datasets.
- All output is JSON; pipe through `jq` for further processing.
