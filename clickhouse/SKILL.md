---
name: clickhouse
description: Execute ClickHouse SQL queries. Supports multiple environments via env var suffixes (e.g. CLICKHOUSE_URL_DEV, CLICKHOUSE_URL_PROD).
---

# ClickHouse

Execute SQL queries against ClickHouse.

## Setup

Set a connection URL:

```bash
export CLICKHOUSE_URL="http://localhost:8123"
# or with environment suffixes:
export CLICKHOUSE_URL_DEV="http://..."
export CLICKHOUSE_URL_PROD="http://..."
```

## Usage

```bash
./scripts/clickhouse.mjs "SELECT count() FROM system.tables"
./scripts/clickhouse.mjs "SELECT * FROM inferences LIMIT 10" --env prod
./scripts/clickhouse.mjs "SELECT database, name, engine FROM system.tables" --format json
./scripts/clickhouse.mjs "SELECT count() FROM events WHERE date >= today() - 7" --timeout 60000
```

### Options

- `--env ENV` — Environment suffix: reads `CLICKHOUSE_URL_<ENV>` (default: dev)
- `--format table|json` — Output format (default: `table`)
- `--ch-format FMT` — ClickHouse output format: `JSON`, `JSONEachRow`, `JSONCompact` (default: `JSON`)
- `--timeout MS` — Query timeout in ms (default: 30000, max: 300000)

## Output

Results are returned as a markdown table (default) or JSON, including query statistics (rows read, bytes read, elapsed time). If results exceed 50KB, they're written to a temp file.

## Tips

- Use single quotes for string literals
- Use backticks for identifiers with special chars
- The env var lookup order without `--env`: `CLICKHOUSE_URL` → `CLICKHOUSE_URL_DEV`
