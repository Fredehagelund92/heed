import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import copyRules from '../eslint.copy-rules.js'
import { concepts } from '../src/domain/words.ts'

/*
  A reading report for a pull request that changes copy (docs/design/copy.md, "The voice"). It is
  a note and never a gate: for each changed file that holds text people read it gives the reading
  level (LIX, as in the language audit: words per sentence plus the share of words over six
  letters), the sentences over 20 words, and any product term of the glossary (src/domain/words.ts)
  that the file did not use before. A term that is new to the app belongs in words.ts first, and a
  reviewer decides that; this only shows where a known term turns up in a file for the first time.

  npm run copy:report                 the files changed since origin/main
  npm run copy:report -- main         the files changed since a ref

  In CI it writes to the job summary of a pull request.
*/

const root = fileURLToPath(new URL('../', import.meta.url))
const base = process.argv[2] ?? 'origin/main'

/** The files whose text people read, as heed/plain-words and the copy rules read them. */
const corpus =
  /^(src\/(web|domain|contract)\/.*\.tsx?|src\/connectors\/[^/]+\/manifest\.ts|db\/seed\/fixtures\/.*\.ts)$/
const notCopy =
  /^src\/web\/components\/(ui|static-renderer)\/|^src\/web\/components\/editor\/(?!labels\.ts)|\.gen\.ts$|^src\/domain\/words(-v1)?\.ts$/

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

/** What the branch changed. A shallow checkout of a pull request has no merge base: its head is the merge, so the plain diff is the change. */
function changedSince(ref: string): string {
  try {
    return git('diff', '--name-only', '--diff-filter=AM', `${ref}...HEAD`)
  } catch {
    return git('diff', '--name-only', '--diff-filter=AM', ref, 'HEAD')
  }
}

const changed = changedSince(base)
  .split('\n')
  .filter((path) => corpus.test(path) && !notCopy.test(path))

const eslint = new ESLint({
  cwd: root,
  ruleFilter: ({ ruleId }) => ruleId === 'copy/read-text',
  overrideConfig: [
    { languageOptions: { parserOptions: { projectService: false } } },
    {
      files: ['**/*.{ts,tsx}'],
      ignores: [],
      plugins: { copy: copyRules },
      rules: { 'copy/read-text': 'warn' },
    },
  ],
})

/** Each string a person reads in some code, as the rules read it. */
async function textsOf(code: string, path: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(root, path) })
  return (result?.messages ?? []).filter((m) => m.ruleId === 'copy/read-text').map((m) => m.message)
}

const sentencesOf = (texts: string[]) =>
  texts
    .flatMap((text) => text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/))
    .filter((s) => /\p{L}/u.test(s))
const wordsOf = (sentence: string) => sentence.match(/\p{L}[\p{L}']*/gu) ?? []

/** The Scandinavian readability number: words per sentence plus the share of words over six letters. */
function lix(sentences: string[]): number {
  const words = sentences.flatMap(wordsOf)
  if (!words.length) return 0
  const long = words.filter((word) => word.length > 6).length
  return Math.round(words.length / sentences.length + (100 * long) / words.length)
}

const terms = Object.values(concepts).map((concept) => concept.name)
const usedTerms = (texts: string[]) => {
  const all = texts.join('\n').toLowerCase()
  return new Set(terms.filter((term) => new RegExp(`\\b${term}s?\\b`).test(all)))
}

const lines: string[] = []
for (const path of changed) {
  const now = await textsOf(readFileSync(join(root, path), 'utf8'), path)
  if (!now.length) continue
  let before: string[] = []
  try {
    before = await textsOf(git('show', `${base}:${path}`), path)
  } catch {
    // A new file: every term in it is new to it.
  }
  const sentences = sentencesOf(now)
  const long = sentences.filter((sentence) => wordsOf(sentence).length > 20)
  const known = usedTerms(before)
  const fresh = [...usedTerms(now)].filter((term) => !known.has(term))
  lines.push(`- \`${path}\`: LIX ${lix(sentences)}, ${sentences.length} sentences`)
  for (const sentence of long) lines.push(`  - ${wordsOf(sentence).length} words: "${sentence}"`)
  if (fresh.length) lines.push(`  - new to this file: ${fresh.join(', ')}`)
}

console.log('## Copy reading report')
console.log()
if (!lines.length) console.log('No changed file holds text people read.')
else {
  console.log(
    'A note, not a gate. LIX under 30 is very easy and under 40 is easy. Keep a sentence under 20 words (docs/design/copy.md).',
  )
  console.log()
  console.log(lines.join('\n'))
}
