import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { copyRuleConfigs } from '../eslint.copy-rules.js'
import { copyRatchetConfigs } from '../eslint.plain-words.js'
import { compareToBaseline, countWords, type WordCounts } from './plain-words-baseline.ts'

/*
  The ratchets on the words people read (docs/design/copy.md, "The voice"; docs/design/voice.md,
  "The guard rail"), run in CI after the lint: `npm run lint:words`. They count, for each file,
  what a rule reports in the code, and compare the counts with a baseline, word by word. A count
  that rises fails, and so does a file that is new with a hit, so no change adds to the drift. A
  fall is only a note: a baseline is lowered with --update whenever it suits, and no change has to
  touch it to pass.

  Two baselines:

  - plain-words.baseline.json: heed/plain-words, the earlier glossary on the server's sentences and
    the demo's fixtures. The web app in src/web is counted too: it starts at zero and has no entry,
    so any word there fails.
  - copy-checks.baseline.json: everything else, by rule. The glossary of the web app on the text
    that the narrow reading takes for code (plain-words-wide) and on what people read outside the
    web app (plain-words-v2), and the rules of eslint.copy-rules.js: whole sentences, sentence
    length, one word for one thing, errors that say three things, no fixed locale, no demo in
    shared code. A sentence over 20 words is a note and never fails.

  npm run lint:words                     check the counts
  npm run lint:words -- --update         write the counts as they are now
  npm run lint:words -- --list [path…]   print every word to change, in all files or those named
*/

const root = fileURLToPath(new URL('../', import.meta.url))
const baselineFile = join(root, 'plain-words.baseline.json')
const copyBaselineFile = join(root, 'copy-checks.baseline.json')

/** The rules counted in copy-checks.baseline.json, by the name they are reported under. */
const copyRules = [
  'heed/plain-words-wide',
  'heed/plain-words-v2',
  'copy/whole-sentences',
  'copy/sentence-length',
  'copy/one-word-one-thing',
  'copy/errors-say-three-things',
  'copy/no-fixed-locale',
  'copy/no-demo-in-shared-code',
]
/** What a rule reports that is a note and not a count that can fail. */
const noteOnly = new Set(['over20'])

type Finding = {
  rule: string
  path: string
  where: string
  message: string
  found: string
}
type CopyCounts = Record<string, WordCounts>

/** What heed/plain-words reports in the code. Only that rule runs, so no type information is read. */
async function codeFindings(): Promise<Finding[]> {
  const eslint = new ESLint({
    cwd: root,
    ruleFilter: ({ ruleId }) => ruleId === 'heed/plain-words' || copyRules.includes(ruleId),
    overrideConfig: [
      { languageOptions: { parserOptions: { projectService: false } } },
      ...copyRatchetConfigs,
      ...copyRuleConfigs,
    ],
  })
  const results = await eslint.lintFiles([
    'src/server',
    'src/web',
    'src/domain',
    'src/contract',
    'src/connectors',
    'db/seed/fixtures',
  ])
  return results.flatMap((result) =>
    result.messages
      .filter(
        (message) =>
          message.ruleId === 'heed/plain-words' || copyRules.includes(message.ruleId ?? ''),
      )
      .map((message) => ({
        rule: message.ruleId ?? '',
        path: relative(root, result.filePath),
        where: `${message.line}:${message.column}`,
        message: message.message,
        // A word rule counts the word; a rule of shape counts the kind of break (its message id).
        found:
          /^Instead of "([^"]+)"/.exec(message.message)?.[1] ??
          /^"([^"]+)" is an engineer/.exec(message.message)?.[1] ??
          message.messageId ??
          message.message,
      })),
  )
}

const print = (findings: readonly Finding[]) => {
  for (const { path, where, message } of findings)
    console.log(`  ${path}${where ? `:${where}` : ''}  ${message}`)
}

const args = process.argv.slice(2)
const all = await codeFindings()
const findings = all.filter(({ rule }) => rule === 'heed/plain-words')
const counts = countWords(findings)
const total = findings.length

/** The findings of the copy rules, less the notes, counted by rule. */
const copyFindings = all.filter(
  ({ rule, found }) => rule !== 'heed/plain-words' && !noteOnly.has(found),
)
const notes20 = all.filter(({ found }) => noteOnly.has(found))
const copyCounts = (): CopyCounts =>
  Object.fromEntries(
    copyRules.map((rule) => [
      rule,
      countWords(copyFindings.filter((finding) => finding.rule === rule)),
    ]),
  )
const readCopyBaseline = (): CopyCounts =>
  JSON.parse(readFileSync(copyBaselineFile, 'utf8')) as CopyCounts

if (args[0] === '--update') {
  writeFileSync(baselineFile, `${JSON.stringify(counts, null, 2)}\n`)
  console.log(
    `plain-words.baseline.json: ${total} words to change in ${Object.keys(counts).length} files.`,
  )
  writeFileSync(copyBaselineFile, `${JSON.stringify(copyCounts(), null, 2)}\n`)
  console.log(`copy-checks.baseline.json: ${copyFindings.length} places to rewrite, by rule.`)
} else if (args[0] === '--list') {
  const paths = args.slice(1)
  const wanted = ({ path }: Finding) => !paths.length || paths.some((p) => path.startsWith(p))
  print([...findings, ...copyFindings, ...notes20].filter(wanted))
  console.log(`${total} words to change in ${Object.keys(counts).length} files.`)
  console.log(
    `${copyFindings.length} places to rewrite, by the rules of copy, and ${notes20.length} sentences over 20 words.`,
  )
} else {
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as WordCounts
  const { more, notes } = compareToBaseline(counts, baseline)
  for (const path of new Set(more.map((entry) => entry.path))) {
    for (const { word, count, allowed } of more.filter((entry) => entry.path === path))
      console.log(
        `${path}: "${word}" is found ${count} times, ${allowed} in the baseline. Write the new text in the glossary's words:`,
      )
    print(findings.filter((finding) => finding.path === path))
  }
  for (const note of notes) console.log(note)
  // The rules of copy, each against its own baseline.
  const copyBaseline = readCopyBaseline()
  const nowByRule = copyCounts()
  let copyMore = 0
  for (const rule of copyRules) {
    const { more: rises, notes: falls } = compareToBaseline(
      nowByRule[rule] ?? {},
      copyBaseline[rule] ?? {},
    )
    for (const path of new Set(rises.map((entry) => entry.path))) {
      for (const { word, count, allowed } of rises.filter((entry) => entry.path === path))
        console.log(
          `${path}: ${rule} "${word}" is found ${count} times, ${allowed} in the baseline:`,
        )
      print(copyFindings.filter((finding) => finding.rule === rule && finding.path === path))
    }
    for (const note of falls) console.log(`${rule}: ${note}`)
    copyMore += rises.length
  }
  if (more.length || copyMore) process.exit(1)
  console.log(
    `Plain words: ${total} words to change in ${Object.keys(counts).length} files, no more than the baseline counts.`,
  )
  console.log(
    `Copy: ${copyFindings.length} places to rewrite and ${notes20.length} sentences over 20 words, no more than the baseline counts. Run \`npm run lint:words -- --list\` to see them.`,
  )
}
