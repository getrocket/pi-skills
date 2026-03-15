---
name: graphql
description: Execute GraphQL queries against a configured endpoint. Supports variables, custom headers, and multiple environments via env var suffixes.
---

# GraphQL

Execute GraphQL queries against a configured endpoint (e.g. Hasura).

## Setup

Set endpoint and optional headers:

```bash
export GRAPHQL_URL="http://localhost:8080/v1/graphql"
export GRAPHQL_HEADERS='{"x-hasura-admin-secret": "secret"}'
# or with environment suffixes:
export GRAPHQL_URL_DEV="http://..."
export GRAPHQL_HEADERS_DEV='{"x-hasura-admin-secret": "..."}'
export GRAPHQL_URL_PROD="http://..."
export GRAPHQL_HEADERS_PROD='{"x-hasura-admin-secret": "..."}'
```

## Usage

```bash
./scripts/graphql.mjs "query { users(limit: 5) { id name } }"
./scripts/graphql.mjs "query { persons_aggregate { aggregate { count } } }" --env prod
./scripts/graphql.mjs 'query GetUser($id: uuid!) { users_by_pk(id: $id) { id name } }' --variables '{"id": "abc-123"}'
./scripts/graphql.mjs "query { jobs { id title } }" --headers '{"x-hasura-role": "recruiter"}'
```

### Options

- `--env ENV` — Environment suffix: reads `GRAPHQL_URL_<ENV>` and `GRAPHQL_HEADERS_<ENV>` (default: dev)
- `--variables JSON` — Query variables as a JSON string
- `--operation NAME` — Operation name (when document has multiple operations)
- `--headers JSON` — Extra headers merged with env defaults
- `--timeout MS` — Request timeout in ms (default: 30000, max: 300000)

## Output

Responses are printed as formatted JSON. If results exceed 50KB, they're written to a temp file.

## Tips

- Headers from `--headers` are merged on top of `GRAPHQL_HEADERS_<ENV>` defaults.
- Use `--headers '{"x-hasura-role": "recruiter"}'` to test Hasura role permissions.
- The env var lookup order without `--env`: `GRAPHQL_URL` → `GRAPHQL_URL_DEV`
