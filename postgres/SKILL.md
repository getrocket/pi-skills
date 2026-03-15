---
name: postgres
description: Execute read-only SQL against PostgreSQL. Supports multiple environments via env var suffixes (e.g. POSTGRES_URL_DEV, POSTGRES_URL_PROD).
---

# PostgreSQL

Execute read-only SQL queries against PostgreSQL.

## Setup

Set a connection string env var:

```bash
export POSTGRES_URL="postgresql://user:pass@host:5432/dbname"
# or with environment suffixes:
export POSTGRES_URL_DEV="postgresql://..."
export POSTGRES_URL_PROD="postgresql://..."
```

## Usage

```bash
./scripts/postgres.mjs "SELECT * FROM users LIMIT 5"
./scripts/postgres.mjs "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
./scripts/postgres.mjs "SELECT count(*) FROM persons" --env prod
./scripts/postgres.mjs "EXPLAIN ANALYZE SELECT * FROM jobs WHERE status = 'open'" --format json
./scripts/postgres.mjs "SELECT * FROM large_table" --timeout 60000
```

### Options

- `--env ENV` — Environment suffix: reads `POSTGRES_URL_<ENV>` (default: dev)
- `--format table|json` — Output format (default: `table`)
- `--timeout MS` — Query timeout in ms (default: 30000, max: 300000)

## Output

Results are returned as a markdown table (default) or JSON. If results exceed 50KB, they're written to a temp file (`$TMPDIR/skill-results/`) and the path is printed.

## Tips

- Use single quotes for string literals: `WHERE name = 'foo'`
- Use double quotes for identifiers: `"Column-Name"`
- Queries are read-only (enforced via `statement_timeout`)
- The env var lookup order without `--env`: `POSTGRES_URL` → `POSTGRES_URL_DEV`
