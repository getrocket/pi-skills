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

Set `BETTERSTACK_GLOBAL_TOKEN` to enable creating ClickHouse connections:

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
./scripts/betterstack.mjs source 312250              # By ID
./scripts/betterstack.mjs source "Titan Node.js"     # By name (fuzzy match)
./scripts/betterstack.mjs source titan_node_js        # By table_name
```

### Create a ClickHouse connection

Creates temporary credentials (cached for ~1 hour). Required before running SQL queries.

**Important:** Sources can live in different data regions. Pass `--region <region>` to route the connection to the correct region. The `logs` and `schema` commands do this automatically by reading the source's `data_region`, but for raw `query` you may need to connect manually with the right region.

```bash
./scripts/betterstack.mjs connect                         # Default 1-hour connection (default region)
./scripts/betterstack.mjs connect --region us-east-9       # Connect to a specific data region
./scripts/betterstack.mjs connect --hours 2                # 2-hour connection
```

If a cached connection exists for a different data region, `logs` and `schema` will automatically reconnect to the correct region.

### Fetch logs (convenience command)

By default, `logs` tries a **combined hot + S3 query** so longer windows like `--since 1h` still work. If the hot log cluster is unavailable, it automatically **falls back to S3-only**.

```bash
./scripts/betterstack.mjs logs titan_node_js                           # Last 1h, 20 rows
./scripts/betterstack.mjs logs titan_node_js --limit 50 --since 24h    # Last 24h, 50 rows
./scripts/betterstack.mjs logs titan_node_js --search "error"          # Filter by text
./scripts/betterstack.mjs logs titan_node_js --historical --since 7d    # Force S3-only query
./scripts/betterstack.mjs logs titan_node_js --raw                      # Show raw JSON only
./scripts/betterstack.mjs logs titan_node_js --verbose                  # Show SQL / fallback details
```

Options:
- `--limit N` — Max rows (default: 20)
- `--since DURATION` — How far back: `5m`, `1h`, `24h`, `7d` (default: `1h`)
- `--search TEXT` — Filter logs containing text
- `--historical` — Query only cold (S3) storage
- `--raw` — Show only the raw JSON column
- `--verbose` — Print SQL and fallback details to stderr

### Run raw ClickHouse queries

Combined hot + S3 example:

```bash
./scripts/betterstack.mjs query "SELECT dt, raw FROM (SELECT dt, raw FROM remote(t185745_titan_node_js_logs) UNION ALL SELECT dt, raw FROM s3Cluster(primary, t185745_titan_node_js_s3) WHERE _row_type = 1) ORDER BY dt DESC LIMIT 20 FORMAT JSONEachRow"
```

S3-only example (useful when the hot cluster is unavailable):

```bash
./scripts/betterstack.mjs query "SELECT dt, raw FROM s3Cluster(primary, t185745_titan_node_js_s3) WHERE _row_type = 1 AND dt >= now() - INTERVAL 24 HOUR ORDER BY dt DESC LIMIT 20 FORMAT JSONEachRow"
```

### Show table schema

`schema` tries the hot log table first, then falls back to the S3 table function if needed.

```bash
./scripts/betterstack.mjs schema titan_node_js
./scripts/betterstack.mjs schema titan_node_js --verbose
```

## Data source table names

For raw queries, use these table name patterns:

| Data type | Table reference | Notes |
|-----------|----------------|-------|
| Recent logs (hot) | `remote(t<team_id>_<table>_logs)` | Fast, recent data when the hot cluster is available |
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
- **Sources live in different data regions.** The `logs` and `schema` commands read the source's `data_region` and automatically reconnect if needed. If you get `CLUSTER_DOESNT_EXIST` or `NAMED_COLLECTION_DOESNT_EXIST` errors on raw `query`, your connection is likely scoped to the wrong region — reconnect with `--region <region>` (e.g. `--region us-east-9`).
- The `logs` and `query` commands auto-create a connection if `BETTERSTACK_GLOBAL_TOKEN` is set.
- The `logs` command automatically falls back to S3 when the hot cluster is unavailable.
- Source names support fuzzy matching — `titan_node` will match `Titan Node.js`.
- For JSON field extraction in raw queries: `JSONExtract(raw, 'field', 'Nullable(String)')`.
- Always use `LIMIT` to avoid memory issues on large datasets.
- All output is JSON; pipe through `jq` for further processing.
