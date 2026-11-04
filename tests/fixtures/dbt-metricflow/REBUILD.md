# The dbt MetricFlow fixture

An invented shop, built by dbt's own parser: `project/` in dbt's legacy YAML spec and
`project-latest/` in the latest one. Nothing here came from a real company, warehouse or person.
Each project covers every metric type and the odd cases the mapping handles: a semantic model with
no domain, a domain that is not a domain id, a metric across semantic models, two dimensions of one
name, a hidden metric, a description over 500 characters, other names that differ only in case, and
SQL in a dimension, a measure and a filter. That SQL stays on purpose: it is what the kit checks
never crosses.

The two projects mean the same, except that `orders.channel` and `customers.status` carry their SQL
in the semantic model in `project/` and in the dbt model (or nowhere) in `project-latest/`, so
those two marks differ, as they should.

## Make it again

With dbt-core 1.12.6, dbt-duckdb 1.11.1 and dbt-metricflow 0.15.0 (MetricFlow 0.213.0), outside the
repository so nothing dbt writes lands here:

```sh
uv venv --python 3.12 .venv
uv pip install dbt-core==1.12.6 dbt-duckdb==1.11.1 dbt-metricflow==0.15.0
cp -R tests/fixtures/dbt-metricflow/project tests/fixtures/dbt-metricflow/project-latest "$WORK"
# In each copy; `dbt parse` reaches no warehouse.
.venv/bin/dbt parse --no-partial-parse --profiles-dir .
```

Then make the environment neutral: every `node_relation` and time spine gets `example_db` and
`example_schema`, and `relation_name` is rebuilt from them. Run this once per project, with the
copy's `target/semantic_manifest.json` and `semantic_manifest.legacy.json` or
`semantic_manifest.latest.json`:

```sh
node -e '
const { readFileSync, writeFileSync } = require("node:fs")
const [from, to] = process.argv.slice(1)
const neutral = (v) => {
  if (Array.isArray(v)) return v.map(neutral)
  if (typeof v !== "object" || v === null) return v
  const o = Object.fromEntries(Object.entries(v).map(([k, e]) => [k, neutral(e)]))
  if ("relation_name" in o) {
    o.database = "example_db"
    o.schema_name = "example_schema"
    o.relation_name = `"example_db"."example_schema"."${o.alias}"`
  }
  return o
}
writeFileSync(to, JSON.stringify(neutral(JSON.parse(readFileSync(from, "utf8"))), null, 2) + "\n")
' "$FROM" "$TO"
```

`definitions.json` is what a read of `semantic_manifest.legacy.json` must give. When the mapping
changes on purpose, write it again and read the change in review:

```sh
npx vitest run --project server tests/server/connectors/conformance.test.ts -t dbt -u
```
