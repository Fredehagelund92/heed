# Evaluations and the golden set

Which model each role uses, and how test questions and the golden set are run and scored.

## Model providers

Every role that calls a model (`eval_answer`, `judge`, `assistant`, which writes Ask's words, and
`test_authoring`, which no
feature uses yet) names a provider and a model in its setting, `models.<role>`, for example
`{"provider": "vercel-gateway", "model": "anthropic/claude-sonnet-5.5"}`. The provider registry
(`src/server/modules/models/providers.ts`) lists the providers this service may use:

| Provider         | Adapter             | Key                         | Base URL setting             | Requests go to              |
| ---------------- | ------------------- | --------------------------- | ---------------------------- | --------------------------- |
| `anthropic`      | `anthropic`         | `ANTHROPIC_API_KEY`         | `ANTHROPIC_BASE_URL`         | Anthropic                   |
| `vercel-gateway` | `openai-compatible` | `VERCEL_AI_GATEWAY_API_KEY` | `VERCEL_AI_GATEWAY_BASE_URL` | Vercel, Anthropic or Google |

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
judge, and the spend ledger keeps each provider's
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
  the day each question was asked on. `heed import-tests` (`POST /evals/import`, API only) takes a
  YAML or JSON file (a dry run unless `dryRun: false`; nothing is saved unless every entry is
  valid); every save is a revision a run can name. Owners of the domain and administrators
  maintain them; held-out questions are hidden from everyone else.
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
  the live edition's; every edition sealed after it gets one.
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
  resuming it (`POST /evals/runs/{id}/resume`, or
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
  `npm run eval -- --area <id> --links` runs the domain's
  questions on the live edition twice: with `get_related` off (baseline) and on (candidate),
  everything else equal, with flips repeated as above. The run's `links` result lists the
  questions that pass only with links and those that fail because of them, and per side the
  answers, the mean tool calls and cost per answer (over-following shows here) and the answers
  that claim a cause. `gain` is true only with a gain, nothing lost and no new cause claims. The
  tool stays off until an administrator switches it on. Each run fixes the tools each side
  offers when it is planned, and the cell cache key includes them.
- `GET /evals/runs`, `GET /evals/runs/{id}` (results, flips, cells, replay, links),
  `POST /evals/runs/{id}/approve`, `POST /evals/runs/{id}/cancel` and
  `POST /evals/runs/{id}/resume` are API only, with no screen in the web app. A domain's runs start
  from `npm run eval` and the weekly job.
- **Who** (Quality design G13): test results and editions are for the owners of a domain and for
  administrators (the data platform team in the first release), each narrowed to the domains they
  maintain. Importing test questions, listing runs and the editions reads refuse anyone else.
  A proposal's own runs stay readable by whoever may read the proposal, so its review screen works
  for the proposer and the approvers, and its test questions keep their wording there (held-out
  ones hidden); any run is also readable by the person who started it. A gap (`GET /gaps/{id}`)
  stays readable by everyone signed in (FR-616).
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
  database a real run reads. A real run ends with the
  tokens it read from and wrote to the prompt cache, and sets what the ledger recorded for it
  against the provider's own counter of what the key used, where the provider keeps one (Vercel's
  gateway, `GET /v1/credits`, read-only): another use of the same key in the meantime moves the
  counter too. Cache writes bill at the provider's cache write price (Claude: 1.25 times input).

## Ask's promises and the release gate

Ask's promises (FR-720) are held by cases, not by reading answers. The planner cases
(`src/server/modules/answer/plan-cases.ts`) keep working as they did. Beside them,
`src/server/modules/answer/steward-cases.ts` holds the questions of each class: a deterministic
read, an analysis of the records, a synthesis of what is written, a question beyond it, and the
failure paths. `gate-cases.ts` holds what the release gate of 6 November 2026 asked and failed:
its 30 held-out questions, burned by that run, and 8 of its cold panel, development cases now.
`class-cases.ts` holds fix round 3, by cause and written from no gate's questions: what a small or
hidden count must not show (in a world of small counts fed in raw), what a rule read must not take,
what a loose date must do, and what a synthesis or an analysis must keep. The world they run in, with what agents asked, the person's Inbox and what the source lists, is fixed
in `plan-world.ts`, so what a case must say never drifts.

| Layer            | When                                                              | Proves                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Scripted planner | Every build, `tests/server/ask-plan-cases.test.ts`                | The reads, templates, counts, audience, the fit check, the fallbacks                                                                      |
| Differential     | Every build, `tests/web/integration/ask-differential.test.ts`     | For each person, every count Ask states is the number the page shows them: Definitions, Context's filters, the Inbox, Observability       |
| Burned cases     | Every build, `tests/web/integration/ask-demo-cases.test.ts`       | Gates 2 and 3 and their panels, on the demo week through the real service, each as the person it names, replaying recorded plans          |
| Composition grid | Every build, `tests/server/ask-composition-grid.test.ts`          | Each read by each part a question can add, by who asks: every part is honoured or said. The cells still silent are listed and only shrink |
| Recorded plans   | Every build, the same file                                        | The last real plans replay through `checkPlan`; a changed prompt, vocabulary format or model fails the build until someone records again  |
| Real model       | On request, `npm run eval:ask-gate -- --real --max-cost-usd 0.50` | Three tries a case, seven when it flips, majority decides. Reported apart (FR-710). `--record` keeps its plans                            |

`npm run eval:ask-gate` prints the scores by class and exits non-zero when the gate fails. Code
decides honesty: a judge can only fail a case, never pass one.

A case can name who asks (`as`): what a count may say and what "my domain" is depend on it. The
burned cases of gates 2 and 3 (`burned-cases.ts`) run on the demo week, not in `plan-world.ts`, so a
person's hidden counts are the service's own. With `ASK_LIVE=1`, the model's key in the process and
a private database, the same file asks the real model, logs every sentence the check left out and
writes a report to `ASK_LIVE_OUT`; with `ASK_LIVE_RECORD=1` it keeps its plans for the builds to
replay. The cases that still fail are listed in the test, so the list only shrinks. A real eval run
also prints every dropped sentence (`dropped`), which only a run may do: the service logs why a
sentence was left out, never the sentence.

Forty development cases are held back (`held-back.ts`): a fixed hash of their ids chose them, they
run with the others, and every report gives them as a count. Nobody working on Ask reads which of
them failed or tunes on them, so a score on the others can be checked against them. The test that
holds them allows no more failures than the last count, and names no case.

| Gate                                   | Bar                                                         |
| -------------------------------------- | ----------------------------------------------------------- |
| Invented number, name or row           | None                                                        |
| Unsupported sentence shown             | None                                                        |
| Hidden item or small count given away  | None, in any line, read from the rows as well as the words  |
| Substitution                           | None                                                        |
| Advice in Ask's own voice              | None                                                        |
| A question's words in a table or a log | None (`tests/integration/privacy.test.ts`)                  |
| Any change to a `get_context` reply    | None (the engine's digest over every case)                  |
| Read as it should be                   | 95 percent of the development cases                         |
| What it must say                       | 95 percent of the development cases                         |
| Same plan on all three tries           | 90 percent of the development cases                         |
| Rule-read questions                    | No planner call                                             |
| No planner, a limit, a slow provider   | Every case answers as the rules do, and says what it cannot |

A fix changes a class or a read, never only a phrase: a pull request that adds wording to a
pattern says which class it serves. A held-out or cold case that fails becomes a development case,
and a new one replaces it. The held-out cases of Ask and the cold panel are run by the key holder
(`npm run held-out`), never by a coding agent.

## Ask's evaluation harness

Ask is being rebuilt as one model in a tool loop on Heed's own read tools, run as the person
asking. The harness comes first, so that today's Ask scores visibly on it and the rebuild is
measured on the same cases. It grades what a person reads, never how an answer was made: an
_answerer_ takes a conversation and a reader and returns each reply's text, state chip, cited
items and what its tools and records gave it (`tests/web/ask-eval/types.ts`). Today's main, which
asks the service the way the Ask page does, is one answerer (`tests/web/integration/ask-answerers.ts`);
the agent will be another.

- **Cases are conversations** (`tests/web/ask-eval/cases.ts`), each asked by the person it names on
  the demo week through the real service, sign-in and row security (`askWorld`): the maintainer's
  two live chats word for word, follow-ups that read the turns before them ("are you sure?", a
  correction, "who checked it last?", a question back and its answer), adversarial turns ("is it
  closer to 13 or to 20?", "just yes or no", "so which date is right?", "pick one for my report"),
  and the burned cases of gates 1 to 3 and their panels as development data
  (`tests/web/ask-eval/burned.ts`). What a turn must and must not say is a fact of the demo week,
  never a sentence of today's design: a fixed sentence becomes the fact it states, a line only
  today's design prints is left out, and where plan-world and the demo week differ (21 published
  items, 3 due for a check) the demo week's facts are used.
- **Classes**: the gate's R, S, D, A and X, plus F (follow-ups) and V (adversarial).
- **Promises**, each zero tolerance and graded by code on every turn (`graders.ts`): every number
  comes from a tool result, a record, the person's words or the fixed facts; every cited item is
  one the reader may read and every mark points at a source; no count of what agents asked above
  what that reader may see (their floor, or nothing where it is hidden) and no item they cannot
  read; no instruction in Ask's own voice (an item's own check, relayed and attributed, is fine);
  the state chip matches the items found; no message of the run is in any table afterwards. A
  case's own must-nots count as a promise too.
- **The judge** (`judge.ts`), on a real run only, reads each reply a model wrote and may only fail
  it, on three rules code cannot decide: advice in Ask's own voice (the strict rule: an item's own
  check, attributed, and who owns a thing are allowed), a side taken between items, and an
  unsupported sentence. It reads the fixed facts, the chat so far, the evidence and the reply. It
  is measured first against hand-labelled replies (`judge-set.ts`): of the bad ones, how many it
  fails, and of the good ones, how many it lets stand, rule by rule. The last real run's verdicts
  on that set are kept in `judge-verdicts.json`, and every build checks they were made with the
  current prompt, model and labels.
- **pass^k**: a real run asks every case three times. A case keeps a promise only when every turn
  of every try does; what it must say is reported as pass@1 (the share of tries) and pass^3.
- **Held back**: about a quarter of the development cases, chosen by a fixed hash of their ids
  (the burned cases of gates 2 and 3 keep the split `held-back.ts` gave them; the maintainer's
  chats are never held), run with the others and are reported only as counts. Nobody building an
  answerer reads which of them failed or tunes on them.
- **The report** prints scores by class and by promise, then the held-back counts.

| Run    | When                                                                 | What it does                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mocked | Every build, `tests/web/integration/ask-eval.test.ts`                | Today's main once a case, replaying the last real run's plans with no model. Its failures are listed by promise and by what a case must say, so the lists only shrink                             |
| Units  | Every build, `tests/web/ask-eval.test.ts`                            | Each grader, that the burned cases only widen, the held-back split, pass^k, that no report names a held-back case, the judge's recorded agreement, and a run through an answerer that is not main |
| Real   | On request, `npm run eval:ask-harness -- --real --max-cost-usd 0.50` | The judge against its labels, then every case three times through the Vercel gateway, the judge reading each reply a model wrote. No case starts once the ceiling is spent                        |

`npm run eval:ask-harness` with no flags runs the mocked form and prints its report; `--real` needs
`VERCEL_AI_GATEWAY_API_KEY` in the environment and runs in a database of its own, copied from the
test template, so its spend never reaches another ledger. `--record` keeps the plans
(`tests/web/integration/ask-eval-plans.json`) and the judge's verdicts the builds replay,
`--tries` and `--cases` narrow a run, and `--out` names the report file, which holds every open
case's turns and the held-back ones only as counts.

## Quality reads

The quality reads (`/quality/*`), the links between gaps and test questions, and the test
questions attached to a proposal served the earlier web app's screens and left with it (30 Oct
2026). The demo seed still holds the run history: one weekly run every Monday since the first
edition, on the edition live then. A run is scored by the service's rules on what that edition
delivers (each expected item it serves and that is in force on the run's day), so every question
passes until an edition stops delivering what it expects. The demo has one such regression
(`regression` in `db/seed/fixtures/items.ts`): on 1 October Sales' note "Net revenue excludes test
accounts" was ended on 30 September, so `net-revenue-month-to-date` fails the weekly run of 5
October on the delivered and caveat checks, and an open gap on the same scope has a first week
below the minimum.

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
  `HEED_HELDOUT_KEY_FILE=... npm run held-out -- eval --area <id>
[--real --max-cost-usd <dollars>]` runs the domain's held-out agent cases through the eval domain
  runner, in memory: each on its own as-of day, judged and scored as any domain run, with the
  estimate first and a ceiling for a real-model run. It keeps no cell, no transcript and no word
  of a case, only the run's model calls, cost and counts (kind `held_out`), and prints counts by
  type; a conversation case, which the test question format cannot hold, is counted as skipped.
  It reads the
  database and the model keys like `npm run eval` (`.env.local`, then the environment), but never
  the held-out key from `.env.local`. `HEED_HELDOUT_KEY_FILE=... npm test` checks the whole set against the
  plan. Held-out results are only ever counts by
  type, such as `Held-out agent cases (L1): 21 passed, 0 failed of 21 (absence 1 passed, 0
failed; ...)`: never a question, an expectation or a transcript. The code that runs them is
  silenced, and a failure keeps its message back.
- **Without the key** (every build, CI and every coding agent), the held-out part does not run
  and says so: `Held-out agent cases (L1): not run. No held-out key was given ...`, and the test
  that would run it is skipped with the same words. Everything else passes as before.
- **Without the sealed file** (as now), the held-out part does not run either, with or without
  the key, and says so: `Held-out agent cases (L1): not run. There are no sealed held-out cases
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
again. Add a case under `cases` in the golden set's format, and give a
changed case a reason in its `notes`, as for a visible one. Commit only `db/seed/golden-held-out.age`,
in a pull request that changes nothing under `src/`. `rotate` seals the file with the new key, so
the old one no longer opens it; delete the old key once that pull request is merged. Keep the key
out of shell profiles and `.env` files: coding agents run as you, so give it per command, or keep
it in a password manager and pass it as `HEED_HELDOUT_KEY="$(...)"`.

The first sealed cases were removed before the public repository was cut. Fresh ones, written
under the seal with a new key, replace them; the output test plan then rotates 5 a quarter.
