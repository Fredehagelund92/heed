# Cube's fixture

Invented, written by hand: `model/model.yml` is a small Cube model (a private cube, views with and
without a domain, a view that joins with a prefix and an alias) whose SQL the kit checks never
crosses.

`definitions.json` is what a read of it must give. When the connector changes on purpose, write
it again and read the change in review:

```sh
npx vitest run --project server tests/server/connectors/conformance.test.ts -t cube -u
```
