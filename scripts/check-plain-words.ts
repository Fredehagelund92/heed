import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { allowedIn } from '../eslint.plain-words.js'
import { helpPageLines } from '../src/domain/help-pages.ts'
import { wordsToChange } from '../src/domain/words.ts'
import { compareToBaseline, countWords, type WordCounts } from './plain-words-baseline.ts'

/*
  The ratchet on the old voice (docs/design/voice.md, "The guard rail"), run in CI after the lint:
  `npm run lint:words`. It counts, for each file, what heed/plain-words reports in the code and
  what the same glossary finds in each help page, and compares the counts with
  plain-words.baseline.json, word by word. It fails when a file has a word more often than the
  baseline allows, or a new file has any, so no change adds old words. A fall is only a note: the
  baseline is lowered with --update whenever it suits, and no change has to touch it to pass.

  npm run lint:words                     check the counts
  npm run lint:words -- --update         write the counts as they are now
  npm run lint:words -- --list [path…]   print every word to change, in all files or those named
*/

const root = fileURLToPath(new URL('../', import.meta.url))
const baselineFile = join(root, 'plain-words.baseline.json')
const helpFolder = 'docs/help'

type Finding = { path: string; where: string; message: string; found: string }

/** What heed/plain-words reports in the code. Only that rule runs, so no type information is read. */
async function codeFindings(): Promise<Finding[]> {
  const eslint = new ESLint({
    cwd: root,
    ruleFilter: ({ ruleId }) => ruleId === 'heed/plain-words',
    overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
  })
  const results = await eslint.lintFiles(['src/web', 'src/server'])
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

/** What the glossary finds in the help pages, which the docs check reads the same way. */
function helpFindings(): Finding[] {
  return readdirSync(join(root, helpFolder))
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .flatMap((file) => {
      const path = `${helpFolder}/${file}`
      return helpPageLines(readFileSync(join(root, path), 'utf8')).flatMap(({ line, text }) =>
        wordsToChange(text, allowedIn(path)).map((change) => ({
          path,
          where: `${line}`,
          message: `Instead of "${change.found}", write: ${change.write}.`,
          found: change.found,
        })),
      )
    })
}

const print = (findings: readonly Finding[]) => {
  for (const { path, where, message } of findings)
    console.log(`  ${path}${where ? `:${where}` : ''}  ${message}`)
}

const args = process.argv.slice(2)
const findings = [...(await codeFindings()), ...helpFindings()]
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
