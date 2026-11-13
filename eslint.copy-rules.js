import { matchesGlob, relative } from 'node:path'
import {
  codeSample,
  kindAndId,
  looksLikeCode,
  readsAsText,
  webNotProductFiles,
  webWordsFiles,
} from './eslint.plain-words.js'

/*
  The rules that keep the shape of the copy, beside the glossary (docs/design/copy.md, "The
  voice"). The glossary check finds a banned word. These find what a list of words cannot: a
  sentence glued together in code, a sentence that runs on, a second word for one thing, an error
  with no message, a fixed locale, a demo's name in code that every install runs.

  Each is a ratchet. scripts/check-plain-words.ts counts what they report in
  copy-checks.baseline.json and fails a change that adds to a count; a fall is only a note. So a
  rule lands before the sentences it finds are rewritten, and the count only goes down.
*/

const wordsOf = (sentence) => sentence.split(/\s+/).filter(Boolean).length

/** Calls `visit(node, text, whole)` for each string a person reads, as heed/plain-words reads them. */
function eachReadText(context, visit) {
  const check = (node, text, whole, isJsx) => {
    if (typeof text !== 'string' || !text.trim()) return
    if (!isJsx && (looksLikeCode(whole) || codeSample(whole))) return
    if (!readsAsText(node, false)) return
    visit(node, text, whole)
  }
  return {
    Literal: (node) => check(node, node.value, node.value, false),
    TemplateElement: (node) => {
      const whole = node.parent.quasis.map((quasi) => quasi.value.cooked ?? '').join('x')
      if (!kindAndId(node)) check(node, node.value.cooked, whole, false)
    },
    JSXText: (node) => check(node, node.value, node.value, true),
  }
}

const nameOf = (node) =>
  node?.type === 'Identifier'
    ? node.name
    : node?.type === 'MemberExpression'
      ? nameOf(node.property)
      : null
const isString = (node) => node?.type === 'Literal' && typeof node.value === 'string'

/** The helpers that make a plural by adding "s" to a word. */
const pluralHelpers = new Set(['plural', 'pluralize', 'countWord'])

// A sentence is built whole, never from parts.
const wholeSentences = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Write a whole sentence for each case, not one glued together in code.' },
    schema: [],
    messages: {
      lowercased:
        'A label is lower-cased into a sentence. Write one whole sentence for each case (copy.md, "The voice", rule 4).',
      article:
        '"a" or "an" stands before a value, which may start with a vowel or a consonant. Write the sentence whole for each case.',
      plural:
        'A plural is made by adding "s". Write both forms whole, or use Intl.PluralRules (copy.md, "The voice", rule 4).',
      split: 'A word is cut in two parts. Write the sentence whole.',
    },
  },
  create(context) {
    return {
      TemplateLiteral(node) {
        const text = node.quasis.map((quasi) => quasi.value.cooked ?? '').join(' ')
        if (!/\p{L}{3,}/u.test(text)) return
        node.expressions.forEach((expression, i) => {
          const before = node.quasis[i].value.cooked ?? ''
          const after = node.quasis[i + 1].value.cooked ?? ''
          if (
            expression.type === 'CallExpression' &&
            ['toLowerCase', 'toLocaleLowerCase'].includes(nameOf(expression.callee) ?? '') &&
            /[\p{L},:;]\s*$/u.test(before)
          )
            context.report({ node: expression, messageId: 'lowercased' })
          if (/(^|\s)(a|an)\s$/i.test(before))
            context.report({ node: expression, messageId: 'article' })
          if (/\p{L}$/u.test(before) && /^\p{Ll}/u.test(after))
            context.report({ node: expression, messageId: 'split' })
        })
      },
      // A plural made by adding "s": `${n === 1 ? '' : 's'}`, or a helper that does it.
      ConditionalExpression(node) {
        if (
          [node.consequent, node.alternate].every(isString) &&
          [node.consequent.value, node.alternate.value].sort().join('|') === '|s'
        )
          context.report({ node, messageId: 'plural' })
      },
      CallExpression(node) {
        if (pluralHelpers.has(nameOf(node.callee) ?? '') && node.arguments.length >= 2)
          context.report({ node, messageId: 'plural' })
      },
      BinaryExpression(node) {
        if (
          node.operator === '+' &&
          isString(node.left) &&
          isString(node.right) &&
          /\s\p{Ll}$/u.test(node.left.value) &&
          /^\p{Ll}/u.test(node.right.value)
        )
          context.report({ node, messageId: 'split' })
      },
    }
  },
}

// One idea in a sentence, and not a long one.
const sentenceLength = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Keep a sentence under 25 words, and mind one over 20.' },
    schema: [],
    messages: {
      over25: '{{words}} words. One idea per sentence, 25 at most (copy.md 2.8).',
      over20: '{{words}} words. About 15 is easier, and 20 is a lot (copy.md 2.8).',
    },
  },
  create(context) {
    return eachReadText(context, (node, _text, whole) => {
      for (const sentence of whole.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)) {
        const words = wordsOf(sentence)
        if (words > 25) context.report({ node, messageId: 'over25', data: { words } })
        else if (words > 20) context.report({ node, messageId: 'over20', data: { words } })
      }
    })
  },
}

/** A second name for a thing the glossary already names, and what to write. */
const secondNames = [
  [/\bRetry\b/, 'Retry', 'Try again'],
  [/\b(sync|syncs|synced|syncing)\b/i, null, 'read'],
  [/\bthreads?\b/i, null, 'comment'],
  [/\b(Needs checking|Overdue)\b/, null, 'Due for a check'],
  [/\bclash(es)?\b/i, null, 'overlap'],
  [/\ba read\b/i, null, 'an update'],
  // Lower case only: the capitals are banned already, the lower case passes.
  [/\b(gap|gaps)\b/, null, 'Not found'],
  [/\b(flag|flags|flagged)\b/, null, 'report'],
]
/** Words for engineers, which belong on the pages for them. */
const engineerWords = /\b(synced|read-only|URL|dev server|queue|facet|ledger|endpoint)\b/i
/** The pages an admin or an engineer reads: Integrations, Agents and access, Advanced. */
const engineerPages = [
  'src/web/pages/integrations.tsx',
  'src/web/pages/settings.tsx',
  'src/web/pages/settings-agents.tsx',
  'src/web/model/integrations.ts',
  'src/web/model/catalogue.ts',
  'src/web/model/settings.ts',
  'src/web/api/http-integrations.ts',
  'src/web/api/http-settings.ts',
  'src/web/api/mock/**',
]

const oneWordOneThing = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Use the glossary’s one word for a thing, and keep engineer words to their pages.',
    },
    schema: [],
    messages: {
      second:
        'Instead of "{{found}}", write: {{write}}. One word for one thing (copy.md, "The voice", rule 2).',
      engineer:
        '"{{found}}" is an engineer’s word. Say it in plain words, or keep it to Integrations, Agents and access, and Advanced (copy.md, "The voice").',
    },
  },
  create(context) {
    const path = relative(context.cwd, context.filename)
    const onEngineerPage = engineerPages.some((glob) => matchesGlob(path, glob))
    return eachReadText(context, (node, text) => {
      for (const [pattern, , write] of secondNames) {
        const found = pattern.exec(text)?.[0]
        if (found) context.report({ node, messageId: 'second', data: { found, write } })
      }
      const found = !onEngineerPage && engineerWords.exec(text)?.[0]
      if (found) context.report({ node, messageId: 'engineer', data: { found } })
    })
  },
}

// An error says what went wrong, what is safe and what to do next.
const errorsSayThreeThings = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Give an error a message, and a toast for an error a next step.' },
    schema: [],
    messages: {
      noMessage:
        'This error has no message. Say what went wrong, what is safe, and what to do next.',
      noNextStep:
        'This error toast has no description and no action. Say what is safe and what to do next.',
    },
  },
  create(context) {
    return {
      NewExpression(node) {
        if (nameOf(node.callee) !== 'ORPCError') return
        const options = node.arguments[1]
        if (!options) return context.report({ node, messageId: 'noMessage' })
        if (
          options.type === 'ObjectExpression' &&
          !options.properties.some(
            (p) =>
              p.type === 'SpreadElement' || (p.type === 'Property' && nameOf(p.key) === 'message'),
          )
        )
          context.report({ node, messageId: 'noMessage' })
      },
      CallExpression(node) {
        const { callee } = node
        if (
          callee.type !== 'MemberExpression' ||
          nameOf(callee.object) !== 'toast' ||
          nameOf(callee.property) !== 'error'
        )
          return
        const options = node.arguments[1]
        if (!options) return context.report({ node, messageId: 'noNextStep' })
        if (
          options.type === 'ObjectExpression' &&
          !options.properties.some(
            (p) =>
              p.type === 'SpreadElement' ||
              (p.type === 'Property' && ['description', 'action'].includes(nameOf(p.key) ?? '')),
          )
        )
          context.report({ node, messageId: 'noNextStep' })
      },
    }
  },
}

const localeCalls = new Set(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'])
const monthName = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/

// Dates and numbers come in the reader's own way.
const noFixedLocale = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Format dates and numbers with the reader’s locale, not a fixed one.' },
    schema: [],
    messages: {
      locale:
        'A fixed locale ("{{locale}}"). Dates and numbers go through Intl with the browser’s locale (copy.md 2.11).',
      months:
        'Month names typed in English. Format a date with Intl.DateTimeFormat (copy.md 2.11).',
    },
  },
  create(context) {
    const fixed = (node, first) => {
      if (isString(first))
        context.report({ node, messageId: 'locale', data: { locale: first.value } })
    }
    return {
      CallExpression(node) {
        const { callee } = node
        if (callee.type !== 'MemberExpression') return
        if (localeCalls.has(nameOf(callee.property) ?? '')) fixed(node, node.arguments[0])
        else if (nameOf(callee.object) === 'Intl') fixed(node, node.arguments[0])
      },
      NewExpression(node) {
        const { callee } = node
        if (callee.type === 'MemberExpression' && nameOf(callee.object) === 'Intl')
          fixed(node, node.arguments[0])
      },
      ArrayExpression(node) {
        const names = node.elements.filter((e) => isString(e) && monthName.test(e.value))
        if (names.length >= 6) context.report({ node, messageId: 'months' })
      },
    }
  },
}

/** The invented people and company of the demo (docs/design/demo-world.md). */
const demoNames = /\b(Larchwood|Jon Abara|Sofia Brandt|Ines Duarte|Kofi Mensah|Ravi Kapoor)\b/
const typedDate = /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* 20\d\d\b/

// The demo is the mock's. Code every install runs does not know it.
const noDemoInSharedCode = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Keep the demo’s words, names and dates to the mock data.' },
    schema: [],
    messages: {
      demo: 'The word "demo" in code every install runs. Keep the demo to src/web/api/mock.',
      name: 'A demo name ("{{found}}") in code every install runs. Keep the demo to src/web/api/mock.',
      date: 'A typed date ("{{found}}"). Take it from the data, and format it with Intl.',
    },
  },
  create(context) {
    return eachReadText(context, (node, text) => {
      if (/\bdemo\b/i.test(text)) context.report({ node, messageId: 'demo' })
      const name = demoNames.exec(text)?.[0]
      if (name) context.report({ node, messageId: 'name', data: { found: name } })
      const date = typedDate.exec(text)?.[0]
      if (date) context.report({ node, messageId: 'date', data: { found: date } })
    })
  },
}

// Not a check: hands the text people read to scripts/copy-report.ts, which reads the changed files.
const readText = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Report each string a person reads, for the reading report.' },
    schema: [],
    messages: { text: '{{text}}' },
  },
  create(context) {
    return eachReadText(context, (node, _text, whole) =>
      context.report({ node, messageId: 'text', data: { text: whole } }),
    )
  },
}

const plugin = {
  rules: {
    'read-text': readText,
    'whole-sentences': wholeSentences,
    'sentence-length': sentenceLength,
    'one-word-one-thing': oneWordOneThing,
    'errors-say-three-things': errorsSayThreeThings,
    'no-fixed-locale': noFixedLocale,
    'no-demo-in-shared-code': noDemoInSharedCode,
  },
}
export default plugin

/** The mock binding and the pages of the demo's own are where the demo lives. */
const demoFiles = ['src/web/api/mock/**']

/** The rules where they apply. They run from scripts/check-plain-words.ts, as ratchets. */
export const copyRuleConfigs = [
  {
    files: webWordsFiles,
    ignores: webNotProductFiles,
    plugins: { copy: plugin },
    rules: {
      'copy/whole-sentences': 'warn',
      'copy/sentence-length': 'warn',
      'copy/one-word-one-thing': 'warn',
      'copy/errors-say-three-things': 'warn',
      'copy/no-fixed-locale': 'warn',
    },
  },
  {
    files: webWordsFiles,
    ignores: [...webNotProductFiles, ...demoFiles],
    plugins: { copy: plugin },
    rules: { 'copy/no-demo-in-shared-code': 'warn' },
  },
  {
    files: ['src/server/**/*.ts'],
    plugins: { copy: plugin },
    rules: { 'copy/errors-say-three-things': 'warn' },
  },
]
