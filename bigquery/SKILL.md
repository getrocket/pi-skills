---
name: bigquery
description: Execute read-only SQL against Google BigQuery. Supports service account JSON files or inline credentials. Safety-capped at 10GB bytes billed.
---

# BigQuery

Execute read-only SQL queries against Google BigQuery.

## Setup

Set credentials via a file path or inline JSON:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
# or inline:
export GOOGLE_APPLICATION_CREDENTIALS='{"type": "service_account", ...}'
# or with environment suffixes:
export GOOGLE_APPLICATION_CREDENTIALS_DEV="/path/to/dev-sa.json"
export GOOGLE_APPLICATION_CREDENTIALS_PROD="/path/to/prod-sa.json"
```

## Usage

```bash
./scripts/bigquery.mjs "SELECT * FROM \`project.dataset.table\` LIMIT 10"
./scripts/bigquery.mjs "SELECT table_id, row_count FROM \`project.dataset.__TABLES__\`"
./scripts/bigquery.mjs "SELECT column_name, data_type FROM \`project.dataset.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = 'my_table'" --format json
./scripts/bigquery.mjs "SELECT count(*) FROM \`project.dataset.table\`" --env prod
```

### Options

- `--env ENV` — Environment suffix: reads `GOOGLE_APPLICATION_CREDENTIALS_<ENV>` (default: dev)
- `--format table|json` — Output format (default: `table`)
- `--timeout MS` — Query timeout in ms (default: 30000, max: 300000)

## Output

Results are returned as a markdown table (default) or JSON, including bytes processed. If results exceed 50KB, they're written to a temp file.

## Tips

- Use backtick-quoted fully qualified table names: `` `project.dataset.table` ``
- Use single quotes for string literals
- Maximum bytes billed is capped at 10GB for safety
- The env var lookup order without `--env`: `GOOGLE_APPLICATION_CREDENTIALS` → `GOOGLE_APPLICATION_CREDENTIALS_DEV`
