# How the product speaks: the voice guide

> **Superseded for the web app.** [Copy](copy.md) is the voice for the Heed v1 web app and for all new text. This guide stays in place because the service's own sentences, the plain-words lint and its ratchet still point to it. Where the two differ, Copy wins.

This page says how to write every word people read: screens, toasts, errors, the help pages, the assistant's replies, the MCP sentence an agent passes on, release notes and demo data. The words themselves, one name for each concept, are in `src/domain/words-v1.ts`. The design contract (section 1, "Display names", and 12.4, item 13) and the help pages' writing rules (`docs/old-help/README.md`) point here.

The specification is written in a strict, rule-stating English on purpose. A screen is not. Write to a person, the way a colleague who knows the numbers would say it.

## Who we write for

People in finance, marketing, operations and management. Many read English as a second language. They know their business and their numbers. They don't know data or AI words, and they should never need to.

## The principles

1. **Talk to the person.** Say "you". Say "we" only when the product or the data team does something: "We check the fact when you send it." The assistant says "I".
2. **Answer first.** The first words say what happened or what to do. The explanation comes after, or goes to a help page.
3. **One idea per sentence.** About 15 words, never over 25. Keep the small words (the, a, that, then) that make a sentence easy to read and to translate.
4. **Say it positively.** Say what is true and what to do. Use one negative sentence at most, and only where it carries weight.
5. **Everyday contractions,** as Notion writes them: "you'll", "it's", "don't", "can't", "isn't" (decided 18 October 2026). Write "not" in full where it carries the weight of the sentence, so nobody misreads it: "This cannot be undone." Avoid unclear contractions ("'d", "'s" for "has") and stacked ones ("wouldn't've").
6. **One name per thing, the glossary's name, everywhere.** Take it from `src/domain/words-v1.ts`. Never a synonym for variety. The program that connects over MCP is the **agent**: always software outside the app, never a person and never the assistant, which is the helper inside it. Write **AI agent** where a reader meets the word cold (the README, the first mention on a help page, the consent screen, what an agent says to a person, the assistant's replies, the tool titles) and **agent** after that, on buttons, tabs, headers, toasts and table cells. A person who works as an agent is named by the role: the support team, never "support agent".
7. **Outcome before mechanism.** "Agents get this fact when a question is about Orders in Norway." Not how matching, editions or delivery work: that belongs in help.
8. **Human values.** "15 June 2026", "1 to 30 September 2026", "3 facts", a person's name, a domain's name. No ISO dates, ids, edition labels, field keys or zero counts on a contributor's screen.
9. **Calm and honest, never cute.** No jokes, no exclamation marks, no "Oops", no praise. No "Sorry", except for an outage we caused.
10. **AI proposes, people decide. Say it in those words.** "The assistant drafts it. You check it and send it. The owner of Sales accepts it."

## Do and don't

| Do                                                                                          | Don't                                                                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| "Agents get this fact from today."                                                          | "It is served in the live edition 2026-10-07.3."                                  |
| "Nothing is written down for orders in France in September."                                | "no_match: no governed item applies to that exact scope."                         |
| "Jon Abara, who owns Sales, will look at it."                                               | "Your proposal was submitted to the domain for review."                           |
| "Leave the end date empty while it is still going on."                                      | "The last day is included. Leave it open if you do not know when it ends."        |
| "We couldn't load the library. Your facts are safe. Check your connection, then try again." | "The connection to the server failed, so nothing is shown."                       |
| "Check again by 31 January 2027"                                                            | "Next check 31 Jan 2027", "Re-check due", "review date"                           |
| "All 5 test questions find it when they should."                                            | "5 of 5 probes behave as expected"                                                |
| One reassurance: "Nothing is saved."                                                        | Three: "No model runs and nothing is recorded: no delivery, no gap and no model." |
| "Archive this fact?"                                                                        | "Retire this item?"                                                               |

## The words

`src/domain/words-v1.ts` holds, for every concept, the name people read, a plain definition, the specification's and the code's words it replaces (`internal`), and the words not to use with what to write instead (`bannedWords`). Its unit test, `tests/unit/words-v1.test.ts`, keeps it consistent. Add or change a name there, in a reviewed pull request, before a screen uses it.

The names that change most often today:

| Write                                              | Not                                                  |
| -------------------------------------------------- | ---------------------------------------------------- |
| fact                                               | item, context item, caveat, piece of context         |
| agent                                              | AI app, client, AI client, model                     |
| what agents get; "Agents get it"                   | served, delivered, delivery, published, goes live    |
| owner (of a domain)                                | steward, deputy, reviewer                            |
| admin                                              | administrator                                        |
| archive                                            | retire                                               |
| edition, on the Editions page and the review stamp | edition anywhere else: write "what agents get today" |
| where it applies; when it applies                  | scope, validity                                      |
| check date; "Check again by 31 January 2027"       | review date, re-check, next check, valid until       |
| test question; hidden test question                | probe, impact set, golden question, held-out, sealed |
| access key                                         | token                                                |

Two names were already decided and stay: **Domain** and **What not to conclude**. So do the five kinds (Event, Note, Guide, Example, Issue), the plain statuses (Accepted, Draft, In review, Changes requested), "Checked before you saw it", "Suggest a change" and "Cause: not proven".

The rename covers only what people read. Code, API fields, the database, addresses and the specification keep their words (item, edition, scope, area). The glossary maps one to the other, and the specification's word list shows both (requirements 2.1, "Name on screen").

## Patterns

- **Buttons and menu items:** a verb and the thing, 2 to 3 words, sentence case, no full stop. "Add a fact", "Send for review", "Archive fact", "Connect an agent". A confirm button repeats the verb of its title ("Archive", not "OK").
- **Empty states:** a title that says what is empty, in the reader's words. Then one sentence with the next event or action, and at most one button. "No facts yet. A fact shows here once the owner of its domain accepts it."
- **Errors:** what happened, whether anything was lost, and what to do. Name a person or team when only they can fix it. No apology, no blame, and no "server", "log" or codes. "We couldn't load the library. Your facts are safe. Check your connection, then try again."
- **Confirmations:** the title is a question with the verb ("Archive this fact?"). Then one sentence on what changes for agents and people, then how to undo it. The reason field's label asks for the reason ("Why are you archiving it?").
- **Toasts:** the result in two to four words, in the past tense, plus at most one short sentence. "Sent for review. Jon Abara will look at it." "Fact archived. Agents no longer get it."
- **Help under a field:** what the field does for the reader, in one sentence. Rules and edge cases go to help. "Agents get this fact when a question is about these."
- **Status lines:** the words people say and whole month names. "Accepted · From 15 June 2026, still going on · Check again by 31 January 2027".
- **Release notes:** a short headline, then one paragraph that starts with what you can now do, then a link. "You can now archive a fact from its page. Agents stop getting it at once, and its history stays."

## The guard rail

Two checks hold the service's text to the glossary, and both read `src/domain/words-v1.ts`:

- **The lint rule `heed/plain-words`** (`eslint.plain-words.js`) reads the notifications, the message of every error the service answers with, and the demo's fixtures. The `say` sentence (`src/domain/say.ts`) is checked against the glossary by `tests/server/mcp/say.test.ts`. The text the MCP gives models (instructions, tool descriptions and `next`) keeps its words.
- **The ratchet** (`npm run lint:words`) also reads the help pages in `docs/old-help` the same way: titles, summaries and every line, without code.

Each reports three things, with what to write instead:

1. A banned word: `Instead of "steward", write: owner.`
2. A negative written in full: `Instead of "could not", write "couldn't", as people say it.`
3. An unclear contraction: `Instead of "you'd", write it in full: you would, or you had.`

Code is never reported. That covers imports, keys, types, comparisons, class names, test ids, addresses, ids and search keywords. It also covers code samples, words made of code's marks (`item_id`, `/library`, `getItem`) and a single lowercase word such as `'item'`, which is a key.

A word the glossary allows somewhere (`allowedOn`) is allowed there. The screens that made those places left with the earlier web app; `surfaces` in `eslint.plain-words.js` lists the files that still make one. When "not" carries the sentence, add the phrase to `fullNegatives` in `src/domain/words-v1.ts`. For anything else that is right on purpose, such as a technical field the data team types in Administration, give the reason on the line: `// eslint-disable-next-line heed/plain-words -- a field the data team types`.

### The baseline

The rule warns while the screens are rewritten (voice plan, slices V4 to V7). `plain-words.baseline.json` holds, for each file, how many times each word it still has to change is found. `npm run lint:words` runs in CI after the lint. It fails on a rise, and a fall is only a note:

- **A file has a word more often than its count, or a new file has any.** The change added old words. The message lists every word in that file with what to write instead. Write the new text in the glossary's words; never raise a count to make it pass. A fixed word never makes room for a new one: counts are kept for each word.
- **A file has fewer than its count.** The check passes and prints a note. Run `npm run lint:words -- --update` when convenient to lower the baseline; no change has to touch `plain-words.baseline.json` to pass.

To read the baseline, run `npm run lint:words -- --list`. It prints every word to change, with its file, line and replacement. Add a path to see one area: `npm run lint:words -- --list src/server/modules/notifications docs/old-help/editions.md`. When every count is 0, the rule becomes an error and the baseline file goes (slice V9).

## Before you ask for review

1. Every name comes from `src/domain/words-v1.ts`.
2. "You" and the outcome come first.
3. At most one negative sentence.
4. No ids, ISO dates or edition labels on a contributor's screen.
5. An error says what happened, then what to do.
6. Read it aloud. Would a colleague say it this way?
