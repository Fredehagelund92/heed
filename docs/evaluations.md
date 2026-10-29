# Evaluations and the golden set

Which model each role uses, how test questions and the golden set are run and scored, and the quality reads on Health.

## Model providers

Every role that calls a model (`eval_answer`, `judge`, `assistant` and `test_authoring`, which no
feature uses yet) names a provider and a model in its setting, `models.<role>`, for example
`{"provider": "vercel-gateway", "model": "anthropic/claude-sonnet-5.5"}`. The provider registry
(`src/server/modules/models/providers.ts`) lists the providers this service may use:

| Provider         | Adapter             | Key                         | Base URL setting             | Requests go to              |
| ---------------- | ------------------- | --------------------------- | ---------------------------- | --------------------------- |
| `anthropic`      | `anthropic`         | `ANTHROPIC_API_KEY`         | `ANTHROPIC_BASE_URL`         | Anthropic                   |
| `vercel-gateway` | `openai-compatible` | `VERCEL_AI_GATEWAY_API_KEY` | `VERCEL_AI_GATEWAY_BASE_URL` | Vercel, Anthropic or Google |

A provider may also name its web search (`webSearch`), for the assistant's `search_web`: the
adapter that speaks it at the provider's base URL, the model that runs it and the price per 1,000
searches. Both providers use Anthropic's web search over the Messages API; through the gateway it
is served by Anthropic only (`gateway.only`), with the same key (checked on 15 October 2026).

Each entry also lists the only models it may serve, with the vendor, the model line and the price
per million tokens; any other model is refused. The gateway serves Anthropic's Claude models
(including `anthropic/claude-haiku-5.5`, the cheapest, at USD 0.10 in and 0.50 out) and
one Google model, `google/gemini-2.5-flash-lite` (vendor `google`, line `gemini-flash-lite`), for
demo data. Keys live only in `.env.local` (or the environment);
a setting names a provider, never a key, and keys are never logged or returned. With `MODELS=live`
the service checks every role's setting at start-up and on every change (`PUT /settings/{key}`), and
refuses an unknown provider, an unlisted model or a missing key with a message that names the
setting. To answer and judge through the gateway, set its key and change `models.eval_answer`,
`models.judge` (or keep `different_family`) and `models.assistant` to `vercel-gateway`.

**Data leaves the company.** With `MODELS=live`, questions, test questions, item text and answers go
to the provider's operator and the model's vendor (the table's last column): a Gemini model sends
them to Vercel and Google. Use real company data
only once the company has approved those providers; until then, only demo content.

Every evaluation run records the provider, model, vendor and family of the answering model and the
judge; an assistant turn logs them (never its text), and the spend ledger keeps each provider's
spend, priced with its own table. The caps (FR-409) count every provider. A `different_family`
judge stays with the answering model's provider and vendor (a Gemini answer is judged by the same
Gemini model, since the gateway lists no other Google line), and a response that names another
vendor's model, as a gateway fallback would, is refused. Another vendor or a second gateway is one
more registry entry; a new protocol also needs one adapter in `adapters/` (the anthropic and
openai-compatible adapters are the examples, and `tests/server/model-providers.test.ts` adds a
provider of each kind).

## Evaluations

The evaluation runner scores the live library: the weekly runs, the runs an owner starts, the
link runs and the runs a change outside the review sets off. It no longer gates a suggestion:
every proposal needs levels 1 to 3 only, at every risk level (FR-513), and the free check of
saved questions follows each publish instead (FR-526). The runs of proposals made before Heed v1
keep the levels 4 and 5 they recorded.

- **Golden questions** (FR-501, FR-504): an id, a domain, a natural and a precise wording, the
  scope in `get_context`'s input form, the items that must and must not be delivered, an optional
  must-have caveat (strict pass), whether a cause may not be claimed or a clarifying question is
  needed, rubrics, risk, source, status and split, and optionally `as_of`, the day it is asked
  on (a golden case keeps its own): a run reads it at that day, so "this past week" means the week
  its expectations were written for, and one without keeps the run's day. `npm run eval` prints
  the day each question was asked on. `PUT /evals/questions/{id}` creates one or
  replaces it with the revision read; every save is a revision a run can name.
  `POST /evals/questions/{id}/set-aside` sets one aside with a reason (FR-514).
  `POST /evals/import` takes a YAML or JSON file (a dry run unless `dryRun: false`; nothing is
  saved unless every entry is valid) and `GET /evals/export` writes one. Owners of
  the domain and administrators maintain them; held-out questions are hidden from everyone else.
- **Runs**: a run of a domain answers its active questions on the live edition. A run of a
  proposed version, made before Heed v1, compared the live edition with the live edition plus the
  version on its impact set (FR-511: every active question whose delivery changes, or that names
  the item) and replayed the stored agent deliveries by topic (FR-512); such runs still finish and
  read as they were, and none is queued any more. Each question's wordings
  are answered by the model through a real MCP client against a loopback copy of the MCP server,
  with the production tool descriptions, on both sides, three tries each; a question that flips
  is repeated to seven tries and the majority decides (FR-515). Every run records the tool
  description digest, the model ids, the client label, the test set digest, the edition, the tries
  and the cost (FR-510). Eval traffic writes no delivery records.
- **Judges**: delivery, absence and citations are checked from the tool results; the caveat, a
  claimed cause, a clarifying question and rubrics are judged by the model with native structured
  output (one retry, then JSON text). The judge grades each rubric by its id (`rubric_1`, ...),
  never by a number it picks; a verdict that leaves a rubric out, grades one twice or grades one
  the question does not have is tried once more, and then kept on the answer as a judge error:
  neither a pass nor a fail, counted in the run's judge-error rate (`judging` in
  `GET /evals/runs/{id}`, and a line of `npm run eval`). A refusal is no answer, never a pass or a
  fail. The two
  layers are kept apart: each question's result names its code-checked and judge-checked verdict
  and the checks that failed, and a scorecard counts both layers and each failed check, so a drop
  can be traced to retrieval and citing or to what the judge read.
- **Retrieval pass** (no model): `evals.retrieval` sends every test question's wordings through
  `get_facts`'s own code on every sealed edition, and on the live edition again each day, and
  stores per question whether it was served, delivered its expected items, left out the forbidden
  ones and gave the expected status (item ids and booleans; never a wording). The first pass is
  the live edition's; every edition sealed after it gets one. `GET /evals/retrieval` (the live
  edition), `GET /evals/retrieval/editions/{label}` and `GET /evals/retrieval/trend` read them,
  each with an optional `area`: owners see their domains, administrators every domain.
- **Triggered full runs**: no answer test runs in the review, so `evals.retrieval` queues a full
  run (no baseline move) of a domain whose newest full or scheduled run is
  older than a change it did not see: new tool descriptions (`tool_descriptions`), a successful
  sync that changed or lost a definition the domain owns (`source_sync`), or a daily pass whose
  deliveries differ from the previous pass of the same edition and overlay (`date_expiry`). The
  run names its `trigger`; the budget and the spending caps hold as for any run.
- **Cell cache** (FR-522): a cell whose inputs did not change (wording, expected results, what
  `get_facts` delivers, tool descriptions, prompts, models and effort, try) reuses the earlier
  result without a model call.
- **Cost** (FR-409, FR-516): every run is estimated first, from typical calls that read and
  write the prompt cache as measured runs do; one above `evals.run_budget_micros` waits for
  `POST /evals/runs/{id}/approve` by an administrator. Before each answer the runner checks the
  monthly cap, the evaluation cap in `limits.llm_feature_monthly_micros` and, for a run a person
  started, their daily limit. Every model call goes through one meter (`models/calls.ts`), which
  writes what the call cost once: the spend ledger's totals and, for a test run, one `model_calls`
  row (tokens in and out, cache reads and writes, reasoning, latency, HTTP status, cost; never
  text) and the run's `actualCostMicros`, in one transaction. Refused tries are rows with no cost;
  a call cut short, even before the provider answered, is billed as an estimate (`estimated`). A
  run approved at the command line has a cost ceiling: no call starts once it is spent, and an
  answer starts only while what was spent, plus 1.5 times an answer's estimate for each answer in
  flight, stays within it.
- **One worker per run**: a worker holds a lease on the run it works and renews it; the
  every-minute job never works a run the command line holds (it used to, and the ledger counted
  such a run twice). A lease that runs out (a stopped process) lets another worker take over.
- **Calls a provider refuses** (output test plan R4 to R6): `models.call_limits` sets how many
  calls run at once per provider and, optionally, requests and tokens a minute per provider and
  model (a free gateway key: concurrency 1, 5 a minute). A call refused for a rate limit (429) or
  failed on the provider's side (5xx, a dropped connection) is tried again after `Retry-After` or
  a jittered backoff, up to 5 tries or 3 minutes. An answer still not made is `throttled` or
  `provider` (`judge` on runs from before judge errors were kept on the answer); one whose tool call the run's
  tool server refused (its request limits count real minutes, though answers are as of the run's
  day) is `tool`: never a quality result. Such a
  run, or one stopped by a cap, its ceiling or Ctrl-C, ends `incomplete` with what is missing;
  resuming it (`POST /evals/runs/{id}/resume`, the run's Resume action, or
  `npm run eval -- --resume <run id>`) makes only those answers. The command refuses, and leaves the run as it was, when the models it would use differ from the run's. The job resumes an incomplete run
  the service started a few times by itself, 15 minutes apart.
- **Judge against code**: a run's result and scorecard name the questions where the judge passed
  what the code checks failed, and the other way round, with the count of tries. A judge that
  passes what code fails is more lenient than the record of what reached the agent.
- **Reliability mode**: `npm run eval -- --pass-rule all` counts a wording only when every try
  passes (pass^k); the default is the majority (FR-515). A run records its rule.
- **Weekly scorecard** (FR-517, FR-518): `evals.weekly` runs the full set of every domain on
  Mondays at 04:00 UTC while the service runs. A finished run moves the domain's baseline, lists
  regressions against the previous one, measures the held-out targets of requirements section
  1.7, and posts an `eval.scorecard` outbox event. A scheduled run that has not finished within a
  day fails with an `eval_run_unfinished` alert; the watchdog alerts when eight days pass without one.
- **Links runs** (FR-523): whether following links helps is measured with `get_related` off on
  one side and on on the other (it is on by default since the agent contract). A link-follow question sets `expected.reachable_via_link` (the
  items whose context the answer must reach through `read_context` or `get_related`, and cite) and
  `expected.forbidden_links` (stale or hidden targets the answer must neither read nor cite).
  `POST /evals/areas/{id}/link-runs` (or `npm run eval -- --area <id> --links`) runs the domain's
  questions on the live edition twice: with `get_related` off (baseline) and on (candidate),
  everything else equal, with flips repeated as above. The run's `links` result lists the
  questions that pass only with links and those that fail because of them, and per side the
  answers, the mean tool calls and cost per answer (over-following shows here) and the answers
  that claim a cause. `gain` is true only with a gain, nothing lost and no new cause claims. The
  tool stays off until an administrator switches it on. Each run fixes the tools each side
  offers when it is planned, and the cell cache key includes them.
- `GET /evals/runs`, `GET /evals/runs/{id}` (results, flips, cells, replay, links),
  `GET /evals/areas/{id}/estimate` (`?kind=links` for a links run), `POST /evals/areas/{id}/runs`,
  `POST /evals/areas/{id}/link-runs`, `POST /evals/runs/{id}/cancel`, `POST /evals/runs/{id}/resume`,
  `GET /evals/cells/{id}/transcript` (owners and administrators, FR-519) and
  `GET /evals/areas/{id}/scorecard`.
- **Who** (Quality design G13): test results, test question upkeep, editions and domain dashboards
  are for the owners of a domain and for administrators (the data platform team in
  the first release), each narrowed to the domains they maintain. Saving, setting aside, importing
  and exporting test questions, listing runs, estimates, starting runs, transcripts, scorecards,
  `GET /areas/{id}/dashboard`, the editions reads and a gap's status and notes refuse anyone else.
  A proposal's own runs stay readable by whoever may read the proposal, so its review screen works
  for the proposer and the approvers, and its test questions keep their wording there (held-out
  ones hidden); any run is also readable by the person who started it. Gaps, topic counts and
  starting a draft from a gap stay with everyone signed in (FR-616).
- **Models**: `MODELS=mock` (the default, and in every test) is a scripted model: it asks
  `get_context` with the question and answers with the delivered ids, titles and summaries and the
  reply's `say` (and, when `get_related` is offered, follows the first delivered item's links once
  and adds the neighbour items in service); the scripted judge grades by fixed rules. `MODELS=live` calls each role's
  provider with explicit model objects (`models.eval_answer`, Claude Sonnet 5.5 on the Anthropic
  API by default, and `models.judge`); a string model is refused by lint. The judge defaults to
  `different_family`: the first model the answering model's provider lists (Opus, Sonnet, Haiku)
  of the same vendor and another family (vendor and model line), since a judge may favour its own
  line's answers. That is a different model line, not a different company, so by default
  `judgeSameVendor` is true; a judge of another vendor is a setting that names it, never a
  fallback. Every run records both providers, families and vendors; `judgeSameFamily` flags a
  judge of the answering model's line and `judgeSameVendor` one from the same vendor. The key
  lives in `.env.local` and is redacted from logs. `npm run eval -- --area <id>` runs a domain now; `--real` needs the key and
  `--max-cost-usd` at or above the estimate it prints first. Only demo content belongs in a
  database a real run reads. A real run (and `npm run eval:assistant -- --real`) ends with the
  tokens it read from and wrote to the prompt cache, and sets what the ledger recorded for it
  against the provider's own counter of what the key used, where the provider keeps one (Vercel's
  gateway, `GET /v1/credits`, read-only): another use of the same key in the meantime moves the
  counter too. Cache writes bill at the provider's cache write price (Claude: 1.25 times input).

## Quality reads

The Workbench's quality reads read one domain or every domain the person maintains (`?area=` narrows; asking for
a domain they do not maintain, or having none, is 403). None of it stores anything new except the
feedback's domain, and none of it returns a test question's or an agent's question text (FR-602).

- `GET /quality/history?area=&limit=` (G2): per finished weekly run of each domain, newest first
  (`limit` per domain, 12 by default): the counts, regressions, rates (pass; held-out caveats, cause
  claims and acceptable answers against the section 1.7 targets), the held-out counts, the code
  and judge layers and failed checks, the no-model retrieval pass of the same edition for the domain
  (the newest made by the time the run finished), and the actual and estimated cost.
- `GET /quality/runs/{id}/compare?against=` (G3): a finished weekly or full run of a domain against
  another of the same domain, by default the weekly run before it. It lists the questions that went
  from failing or unanswered to pass (`better`, with the checks they failed before) and from pass
  to failing or unanswered (`worse`, with the checks they fail now), the rest by verdict, and the
  exact two-sided sign test on the questions that changed (`pValue`, null when none changed).
  Runs that are not finished or of another domain answer 422; a proposal's runs are not compared.
- `GET /quality/feedback?area=&weeks=` (G8): feedback from `report` (and `give_feedback`, its
  deprecated id) per verdict, week and domain. Feedback
  keeps the domain of the delivery it names (or of the gap it opened), so it outlives the 180-day
  purge of delivery rows. Every count below `privacy.min_count` is null (FR-614), and so is a
  row's `total` when it or any verdict count in the row is hidden. Feedback no delivery or gap
  places is a row with a null domain, for an administrator asking for every domain.
- `GET /quality/apps?weeks=`: how the agents that called the MCP server fared (FR-410), per app
  family and week (this week by default, at most 12): tool calls, and of them `needMoreDetail`
  and `noMatch` reads, `invalidInput` calls (arguments the tool could not read, FR-345) and
  `errors`. A family is one of a fixed list (`src/domain/app-family.ts`), mapped from the name an
  app sends about itself, which is never kept: any other name is `other`, none is `unknown`.
  Each count below `privacy.min_count` is null and each week is a cell of its own. Starting a
  session or listing tools is not a tool call. Health shows this week under the ratings, on the
  overview that covers every domain the person looks after (none picked, or only one to look after), and so does the Activity tab of the MCP and gateway page.
- `GET /quality/ratings?area=&weeks=`: the assistant's ratings (FR-712) per verdict, week and
  domain, as G8 counts feedback: `helpful`, `wrong` and `total` for each of the last `weeks` weeks
  (8 by default), each null below `privacy.min_count` and the total also when either count is
  hidden. Each week is a cell of its own, so no hidden count can be worked out by subtracting one
  period from another. Ratings about no one domain are a row with a null domain, for an
  administrator asking for every domain. Health shows this week for every domain under the
  overview's grid, and a domain's last eight weeks in its record.
- `GET /quality/upkeep?area=&weeks=` (G9): per week and domain, the items past their review date at
  the end of the week (today for this week; the domain dashboard's rule, on the last edition sealed
  by then) and the proposals accepted during it.
- `GET /quality/untested?area=` (G12): per domain, the live edition's items the library shows, how
  many no active test question names (must or must not deliver, or reach through a link; a
  set-aside question names nothing), and of those the events and examples, which need one (FR-502).
- `GET /quality/fix-next?area=&limit=` (G14): one ranked list of test questions failing the
  newest weekly run or the newest retrieval pass of the live edition, open gaps, items past review
  and untested items, each with its reasons in words, its failing checks and a date. The weights
  are one table in `src/domain/quality.ts` (`fixWeights`): a regression first, then failures the
  retrieval check proves, open gaps by severity and reports, items past review, untested items.
  Topic-spanning gaps appear only for an administrator asking for every domain.
- `GET /quality/questions/{question}/compare?run=&against=` (Workbench): one test question
  across a finished weekly or full run of its domain and another (by default the weekly run before
  it). Each side has the run's edition, models, tool description and prompt digests and tries,
  the question's revision, verdict and layers, and per wording each try: passed, refused, error,
  checks, the items delivered and reached, the statuses, the judge's reason and the final answer
  from the transcript. `heldConstant`, `changed` and `unknown` sort the edition, revision,
  wordings, tries, answering model, judge, tool descriptions and prompt (a factor a run did not
  record is unknown, never held), so only the edition differs when `changed` is `["edition"]` and
  `unknown` is empty. `items` lists the items the question names or either run delivered that
  differ between the two editions, from the editions comparison. It stores nothing and reads
  what `evals.runs.get` and `evals.transcript` already show the same readers. A held-out
  question is not found for anyone but its domain's maintainers (FR-503); a run of another domain,
  or one that is not a finished weekly or full run, answers 422.
- `GET /quality/questions/{question}/history?limit=` (Workbench): the question in its domain's last
  `limit` (12 by default) finished weekly and full runs, newest first, as tested (revision,
  verdict and layers), set aside or absent, and its result in the newest retrieval pass of each of
  the last `limit` editions.
- `POST /gaps/{id}/tests` and `POST /gaps/{id}/tests/{question}/unlink` (Workbench, FR-610): an
  owner of the gap's domain, or an administrator, links a test question of that domain
  that captures the gap, optionally with `evidenceRun`, the weekly or full run of the domain that
  showed it failing, and unlinks it. Linking a linked test or unlinking one that is not changes
  nothing. A question of another domain, or a gap whose topic spans domains, answers 422; a held-out
  question is not found for anyone but its domain's maintainers. `GET /gaps/{id}` adds
  `resolvedEdition` (the live edition when an owner resolved it; null for a gap resolved before
  that was recorded), `verifiedAt` and `verifiedEdition` (verified by test) for every reader, and
  for the gap's managers `tests` (each with its linked hour, evidence run, first pass on the
  resolving edition or later, and its result in the newest weekly or full run that tested it) and
  `history` (its rows of the history log: action, hour and details, never who). Leaving
  `resolved` clears the edition, the verification and the passes. When a weekly or full answer run
  of the domain finishes (in the same transaction), each linked test's first pass on the resolving
  edition or later is recorded, and a resolved gap whose linked active tests have all passed is
  verified by test, audited as the service and announced to the domain's owners with
  a `gap.verified` outbox event. Impact runs, cancelled or failed runs, and runs on an older
  edition change nothing; a verification stays when a test fails later. A draft started from the gap
  carries its active development tests of the draft's domain (FR-524).
- `GET /proposals/{id}/tests`, `POST /proposals/{id}/tests` and
  `POST /proposals/{id}/tests/{question}/detach` (Workbench, FR-524): the test questions attached
  to a proposal's check. The draft's author attaches and detaches while it is a draft; the domain's
  owners and administrators until a decision. Only an active development question of
  the proposal's domain is attached (422 otherwise); a held-out question is not found for anyone but
  its domain's maintainers. Attaching an attached test or detaching one that is not changes nothing;
  each change is in the history log (`proposal.test_attached`, `proposal.test_detached`), and a
  proposal that moves to another domain leaves the old domain's tests behind. Level 3 marks each
  attached question in its details (`attached`), and the gate adds `attached`: each test with its
  level 3 result (no answer test runs on a proposal, so `answer` is null). Attaching is
  report-only and changes no outcome: a domain question level 3 checks anyway counts as it always
  did. The assistant's draft check names the attached tests with their result.
- The mock binding answers the same (`src/web/api/mock-quality.ts`): one weekly run every Monday
  since the first edition, on the edition live then. A run is scored by the service's rules on
  what that edition delivers (each expected item it serves and that is in force on the run's day),
  so every question passes until an edition stops delivering what it expects. The demo has one
  such regression (`regression` in `db/seed/fixtures/items.ts`): on 1 October Sales' note "Net
  revenue excludes test accounts" was ended on 30 September, so `net-revenue-month-to-date` fails
  the weekly run of 5 October on the delivered and caveat checks, and an open gap on the same
  scope has a first week below the minimum. It keeps no feedback, so feedback counts are zero;
  upkeep, untested items and Fix next come from its library, proposals, gaps and runs.
  A question across two runs is read from its runs and transcripts like the service's stored
  scores; it keeps no revisions, so a run uses the question's current one, and the items that
  differ come from the mock's editions comparison, as on the service.

### The sealed held-out cases

No component grades its own change (FR-525). The golden set's held-out cases are not in
`db/seed/golden-set.yml`, which holds only the development cases: they go in
`db/seed/golden-held-out.age`, encrypted with [age](https://age-encryption.org) to one key. No
cases are sealed at present: the file is absent until the key holder seals fresh cases with a new
key (`npm run held-out -- edit` starts it). age was chosen because it is a small, reviewed file
format with one modern construction (X25519 and ChaCha20-Poly1305) and no settings to get wrong,
and its TypeScript implementation by age's author (`age-encryption`) needs no native code; the
file also opens with the `age` command, so the key holder is not tied to these scripts.

The key is never committed and never in a worker's, CI's or a coding agent's environment. A
command gets it only from `HEED_HELDOUT_KEY_FILE` (a file holding it) or `HEED_HELDOUT_KEY` (the
key), set for that one command; nothing looks for it anywhere else. Prefer the file: a key on
the command line shows in the process list and the shell's history.

- **With the key**, `HEED_HELDOUT_KEY_FILE=~/.heed/held-out.key npm run test:integration --
golden-set` runs the held-out agent cases through the L1 pass too, and
  `HEED_HELDOUT_KEY_FILE=... npm run eval:assistant -- --as <email> --golden` runs the held-out
  assistant cases after the visible ones, as a run of their own within the same ceiling, recorded
  with none of their words. `HEED_HELDOUT_KEY_FILE=... npm run held-out -- eval --area <id>
[--real --max-cost-usd <dollars>]` runs the domain's held-out agent cases through the eval domain
  runner, in memory: each on its own as-of day, judged and scored as any domain run, with the
  estimate first and a ceiling for a real-model run. It keeps no cell, no transcript and no word
  of a case, only the run's model calls, cost and counts (kind `held_out`), and prints counts by
  type; a conversation case is the assistant runner's and is counted as skipped. It reads the
  database and the model keys like `npm run eval` (`.env.local`, then the environment), but never
  the held-out key from `.env.local`. `HEED_HELDOUT_KEY_FILE=... npm test` checks the whole set against the
  plan (about a third of the assistant cases held out). Held-out results are only ever counts by
  type, such as `Held-out agent cases (L1): 21 passed, 0 failed of 21 (absence 1 passed, 0
failed; ...)`: never a question, an expectation or a transcript. The code that runs them is
  silenced, and a failure keeps its message back.
- **Without the key** (every build, CI and every coding agent), the held-out part does not run
  and says so: `Held-out assistant cases: not run. No held-out key was given ...`, and the test
  that would run it is skipped with the same words. Everything else passes as before.
- **Without the sealed file** (as now), the held-out part does not run either, with or without
  the key, and says so: `Held-out assistant cases: not run. There are no sealed held-out cases
...`. It counts nothing and fails nothing: `npm run held-out -- eval` exits 0, and `count` says
  that no cases are sealed.
- **The guard** (`scripts/check-held-out-seal.ts`, the "Held-out seal" job of CI) fails a pull
  request that changes the sealed file or the seal's own code together with anything under
  `src/`, that deletes or moves the sealed file, that commits held-out cases in plain text or in
  the visible file, or whose code outside the seal names the sealed file, the key's variables, the
  age library or a function that hands out the cases. The rules on the sealed file hold once it
  exists again; the others hold now. Make "Held-out seal" a required check, so a pull request
  cannot drop it.

The key holder, in their own terminal (`scripts/held-out.ts`):

```sh
npm run held-out -- keygen                    # makes the key: says where it saved it (default
                                              # ~/.heed/held-out.key, yours only), never prints it
HEED_HELDOUT_KEY_FILE=~/.heed/held-out.key npm run held-out -- count   # cases by type
HEED_HELDOUT_KEY_FILE=~/.heed/held-out.key npm run held-out -- eval --area <domain id>
                                              # the domain's cases through the eval runner, counts
HEED_HELDOUT_KEY_FILE=~/.heed/held-out.key npm run held-out -- edit    # add or change cases
npm run held-out -- keygen --out ~/.heed/held-out-2.key                # a new key, then:
HEED_HELDOUT_KEY_FILE=~/.heed/held-out.key npm run held-out -- rotate --new-key ~/.heed/held-out-2.key
```

`edit` decrypts the cases into a private temporary file (yours only), opens it in `$VISUAL` or
`$EDITOR`, checks what you saved against the golden set's format (every case `split: held_out`),
seals it again and removes the file; while it does not fit, it says where and offers to open it
again. Add a case under `cases` (agent) or `assistant` in the golden set's format, and give a
changed case a reason in its `notes`, as for a visible one. Commit only `db/seed/golden-held-out.age`,
in a pull request that changes nothing under `src/`. `rotate` seals the file with the new key, so
the old one no longer opens it; delete the old key once that pull request is merged. Keep the key
out of shell profiles and `.env` files: coding agents run as you, so give it per command, or keep
it in a password manager and pass it as `HEED_HELDOUT_KEY="$(...)"`.

The first sealed cases were removed before the public repository was cut. Fresh ones, written
under the seal with a new key, replace them; the output test plan then rotates 5 a quarter.
