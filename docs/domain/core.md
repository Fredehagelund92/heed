# Heed domain core

`src/domain` has no database, transport, environment, clock or model dependency. Calendar dates,
source availability, edition content, overlay state and preview authority are inputs. Hashing uses
Web Crypto SHA-256 without keys or randomness. Domain tests run in the scaffold's Node server
project: `npx vitest run --project server tests/server/domain`.

## Entry points

- `item-version.ts`: the strict governed content schema, its structural JSON Schema and content/core
  digests. `item.ts` remains the existing library projection. Cross-field refinements run in the
  TypeScript validator; JSON Schema describes the structural constraints, so imports must also use
  `itemVersionSchema`. References, scope, conflicts and replacements are sets for digest purposes;
  evidence and mentions retain their order. The core digest excludes review date and change marks.
- `proposal.ts`: proposal records and allowed state transitions. These functions do not authorize
  decisions or persist state. Database enforcement and the write interface belong to later slices.
- `validity.ts`: real UTC calendar dates, half-open windows and overlap. End dates are exclusive.
- `vocabulary.ts`: governed stable keys and parents; accent-insensitive names and aliases; ambiguous
  names return options. Trigram suggestions never silently replace the caller's words.
- `scope.ts`: the one reader of a question's names and dates, for `get_context`, `find_context`,
  `report` and Try it (`extractScope`, `readQuestion`). Structured scope
  takes precedence per field. Names are read by `termsInText`: whole-word, longest-name matching
  over every name a term goes by (`namesOf`: key, name, other names and the source member its
  definition points at), the same names `resolveTerm` reads a structured field by. A phrase that
  names several terms chooses none and is reported. A source member name counts only when its view
  is one a term points at, or when it is the whole text. Dates are read in the words the names did
  not take, by `readDates` (`dates.ts`); the result says how (`dates`: the words and a reads-as
  phrase). Unreadable dates and explicitly unknown dimension values require more detail; the dates
  issue says which words and what Heed reads. A question that gives no dates at all is read at the
  supplied `today`, and the result says so (`assumed`, worded by `assumedDate`). A word after a
  dimension name is not a candidate value when it is a preposition, an everyday word
  (`everyday-words.ts`: "how is the mobile team doing") or part of a date (so `market in August
2026` and `market last 7 days` stay resolvable). A dimension named without a value becomes a
  filter with no values (`{ 'dim:market': [] }`), and a named dimension alone is scope. `spans`
  gives where each name and the dates sit in the words as written. This is a conservative
  vocabulary parser, not general language understanding; callers should supply structured scope,
  especially for multiword unknown values.

  Value words (value linking, slice V1) are read by fixed rules, never guessed. A value name that
  several dimensions share ("Alder": Aisle, Brand, Audience) is narrowed first: a dimension's name
  beside it keeps that dimension's value ("the Alder brand", "brand: Alder"), and is then no split
  by that dimension; else the metrics the question names keep the values of the dimensions their
  views can be split by (Orders is not split by Audience). One left is read; more are asked about,
  every one kept (Ask's question names eight and counts the rest: "Alder is a value of Aisle and
  Brand. Which do you mean?"), and a person may answer with the dimension ("the brand one"). A
  short code, a value's name of three letters or fewer its owner wrote in capitals ("NO", "UK"),
  is read in Ask only when written in capitals or beside its dimension's name, so "no" and "it"
  stay everyday words; agents read it in any case, as before. In Ask only (`loose`), a word that
  names nothing Heed knows and sits where a value goes is a value Heed does not have, said and
  never dropped, so the answer is Not found: after in, for, from, to, at or across, with or
  without "the" ("orders from jordan", "orders in the Nordics"), right before a metric when it
  starts what is asked ("jordan orders", "the jordan orders", never "who owns orders") or right
  before a dimension's name ("the jordan market", which then says the dimension). It is one word,
  or a run of Title-case words ("New York"), and never an everyday word ("in total", "in gbp",
  "at the moment", "pending orders"), a lowercase word ending in -ed right before a metric ("cancelled orders"), a verb
  after "to" that follows an everyday word ("going to recover"), a number, a word in capitals
  ("YTD"), a plural right after the place word ("in stores"), another form of a known name, a word
  before a day's name ("black friday week") nor a tool's or the product's name; a question that
  names nothing to look up leaves its words to the word search. The issue names the dimensions it
  could be a value of and, for a typo or a lowercase short code, the value it is close to. Agents
  read such a word as before (dropped); the narrowing and everyday words read alike for every
  caller. These rules by place are deliberately small: this is their fourth narrowing, and each
  trades a missed word for fewer false alarms. The principled fix is value linking V2, one index
  of every value name with near-miss asking, so a value word is known by the list rather than
  guessed from where it sits. The golden questions are `tests/server/domain/value-linking.test.ts`.

- `dates.ts`: `readDates`, the period the words of a question name, counted from `today` in one
  time zone (UTC: Heed has no company time zone, NFR-048), with a reads-as phrase such as "1 Jan to
  7 Oct 2026 (this year so far; UTC)". It reads an ISO day, a day, month or quarter with or
  without a year (without one, the latest that has started), a bare year, ranges ("1 Jan to 30
  Sep", "from March to May 2026", "6 and 7 October"), the periods named from today (`periods`:
  this, last or next week, month, quarter or year, year to date, today, yesterday) and the days
  back to today ("the last 30 days", "this past week"). A named period is whole, "this" runs to
  today, "last" is the last complete one, and weeks start on Monday. Words that name a period it
  cannot read ("since the launch", "the first week of October", a numeric date such as 12/10/2026) or more than one period are never
  replaced: it says which words and what it reads.
- `scope-search.ts`: the page of terms behind the "Applies to" picker (FR-107): before anything
  is typed, the person's recent terms; then metrics and, per dimension, "any value", a count and a
  few values, recent and often-used first; a page at a time inside one dimension. The caller passes
  the vocabulary, the person's recent keys and the uses per key.
- `resolver.ts`: `resolve(bundle, request)` returns deterministic matching metadata, restrictions,
  source flags, exclusions, replacements, cut ids, edition/overlay, check report and system
  instructions. Bundles contain one row per item. A scope may name a dimension with any value
  (`scope.dimensions`, FR-126): the item matches only a question that names that dimension, with or
  without values, and then as an exact match. A fresh local metric index avoids stale indexes
  being paired with another edition. No mutable cache is shared between calls.
- `canonical.ts`: recursively sorted object keys, ordered arrays and finite JSON values. Undefined,
  cycles, non-JSON objects and lone surrogates are rejected. Edition digests hash sorted newline
  separated `item:<id>:<digest>`, `vocab:<key>:<digest>`, `area:<id>:<state>` lines, without a final
  newline, as specified by the SQL plan. Database parity is an integration responsibility after S1.

## Mention grammar decisions

A token is `@[label](target)`. Targets are `metric:`, `dim:`, `val:dimension/value`,
`item:itm_...` and `area:` stable keys, and `term:<id>` for a term written in Definitions
(FR-138), by the term's id. `group:` and raw source member names are not targets. A new version
may keep a mention its published version has of a target no longer there (FR-132 refuses only a
new one).
Labels must be nonempty and may contain an opening bracket, parentheses, backslashes and Unicode,
but never a closing bracket, CR or LF. A closing bracket cannot be escaped inside a label.
The picker should reject or remove those disallowed characters before serializing a token.

Outside a token, `\@` means a literal `@`, and `\\` means one literal backslash. Other backslashes
are retained. Thus odd backslash runs escape the following `@`; even runs allow a token. The
serializer escapes backslashes and `@` in literal text, so literal token-looking text round trips.
Labels are read verbatim, without escape processing. Adjacent tokens are allowed. The parser applies
across the supplied text, including Markdown code spans; it is not a Markdown parser. Authors use
`\@` to make a token-looking example literal.

Malformed token candidates remain literal text and return their UTF-16 starting offsets as errors.
No nested token recovery occurs within a malformed candidate. Submission validation rejects the
errors, rather than silently dropping a malformed link. Mention `position` is a zero-based token
ordinal in its field, not a character offset. Summary tokens come before body tokens in the version
list. `validateMentionTargets` consumes an edition-provided list of target states and checks self
references, missing/retired/source-missing targets and the configured cap (default 50).

Mentions never enter scope extraction from item content, matching, audience, domain assignment or
freshness. The parser and schemas are S2. Link resolution, access-controlled link rendering and
link budget trimming are owned by S5/S19, not implemented here.

## Resolver boundary

The resolver budgets item text in Unicode code points, including summary and body. It removes the
lowest-ranked tail: partial before exact, low before high risk, older before newer validity start,
then descending id (retained ids are ascending). It never fills spare room with a lower-ranked item
after removing a higher-ranked one. The transport must budget its own envelope and links before
passing the remaining item-text budget. Internal withheld ids are for trusted service code; an API
must publish counts rather than hidden ids.

The first build accepts only `audience: { kind: 'everyone' }` in governed content. The existing
library audience union and dormant pure predicates for C17/C26 remain covered without introducing
a group directory, memberships or connector visibility ingestion. First-version callers pass empty
`groups` and `hiddenMetrics` arrays. Metric groups for scope remain supported and are unrelated to
access groups. A metric may have no domain mapping. Its item still needs a domain.

A preview input represents trusted authority supplied by the service, never a client assertion.
Nonaccepted content is otherwise excluded. Unavailable dependencies produce `check_failed` before
scope checks. Source flags and overdue reviews mark normal/low risk unverified and withhold high
risk. Restrictions identify unfiltered dimensions; `startsAfterQuestion` records partial date
coverage. Replacement ids are returned only for accepted, everyone-visible targets in domains.

## Evidence

The suite executes all C01-C26 rows, reverses each bundle and interleaves unrelated calls. The
independent full-scan oracle uses a different selection/removal implementation and is compared on
20,000 generated cases with a fixed seed. Properties also cover canonical JSON/digest round trips,
mention text/token round trips, scope normalization and UTC overlap against enumerated days.
No HTTP endpoints, migrations, persisted write flow or UI changes are part of this slice.
