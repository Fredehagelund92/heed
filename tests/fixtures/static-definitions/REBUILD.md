# The static list's fixture

Invented, written by hand: `list.json` is the list an administrator writes in the form, with a
domain the settings map (`Money`), one that is not a domain id and a description over 500
characters.

`definitions.json` is what a read of it must give. When the connector changes on purpose, write
it again and read the change in review:

```sh
npx vitest run --project server tests/server/connectors/conformance.test.ts -t static-definitions -u
```
