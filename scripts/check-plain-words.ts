import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { compareToBaseline, countWords, type WordCounts } from './plain-words-baseline.ts'

/*
  The ratchet on the earlier voice (docs/design/voice.md, "The guard rail"), run in CI after the lint:
  `npm run lint:words`. It counts, for each file, what heed/plain-words reports in the code, and
  compares the counts with
  plain-words.baseline.json, word by word. The web app in src/web is counted too: it starts at zero
  and has no entry in the baseline, so any word there fails. It fails when a file has a word more often than the
  baseline allows, or a new file has any, so no change adds old words. A fall is only a note: the
  baseline is lowered with --update whenever it suits, and no change has to touch it to pass.

  npm run lint:words                     check the counts
  npm run lint:words -- --update         write the counts as they are now
  npm run lint:words -- --list [path…]   print every word to change, in all files or those named
*/

const root = fileURLToPath(new URL('../', import.meta.url))
const baselineFile = join(root, 'plain-words.baseline.json')

type Finding = { path: string; where: string; message: string; found: string }

/** What heed/plain-words reports in the code. Only that rule runs, so no type information is read. */
async function codeFindings(): Promise<Finding[]> {
  const eslint = new ESLint({
    cwd: root,
    ruleFilter: ({ ruleId }) => ruleId === 'heed/plain-words',
    overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
  })
  const results = await eslint.lintFiles(['src/server', 'src/web', 'db/seed/fixtures'])
  return results.flatMap((result) =>
    result.messages
      .filter((message) => message.ruleId === 'heed/plain-words')
      .map((message) => ({
        path: relative(root, result.filePath),
        where: `${message.line}:${message.column}`,
        message: message.message,
        found: /^Instead of "([^"]+)"/.exec(message.message)?.[1] ?? message.message,
      })),
  )
}

const print = (findings: readonly Finding[]) => {
  for (const { path, where, message } of findings)
    console.log(`  ${path}${where ? `:${where}` : ''}  ${message}`)
}

const args = process.argv.slice(2)
const findings = await codeFindings()
const counts = countWords(findings)
const total = findings.length

if (args[0] === '--update') {
  writeFileSync(baselineFile, `${JSON.stringify(counts, null, 2)}\n`)
  console.log(
    `plain-words.baseline.json: ${total} words to change in ${Object.keys(counts).length} files.`,
  )
} else if (args[0] === '--list') {
  const paths = args.slice(1)
  print(findings.filter(({ path }) => !paths.length || paths.some((p) => path.startsWith(p))))
  console.log(`${total} words to change in ${Object.keys(counts).length} files.`)
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
  if (more.length) process.exit(1)
  console.log(
    `Plain words: ${total} words to change in ${Object.keys(counts).length} files, no more than the baseline counts.`,
  )
}
