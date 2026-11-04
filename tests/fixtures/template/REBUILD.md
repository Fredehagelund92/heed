# The template's fixture

Invented, written by hand: an example tool's metrics file, `metrics.json`, with every case the
template's mapping handles (a group without a domain, a domain that is not a domain id, a metric
built on others, a description over 500 characters, other names that differ only in case, a
value type the mapping does not know) and the calculations the kit checks never cross.

`definitions.json` is what a read of it must give. When the mapping changes on purpose, write it
again and read the change in review:

```sh
npx vitest run --project server tests/server/connectors/conformance.test.ts -t template -u
```
