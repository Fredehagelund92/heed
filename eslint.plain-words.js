import { matchesGlob, relative } from 'node:path'
import { bannedWords, wordsToChange } from './src/domain/words-v1.ts'
import { wordsToChange as appWordsToChange } from './src/domain/words.ts'

/*
  The words people read take their names from a glossary. The web app in src/app follows glossary
  v2 (src/domain/words.ts, docs/design/copy.md); the server's sentences and the demo's fixtures
  follow the earlier one (src/domain/words-v1.ts, docs/design/voice.md). This reports a string,
  template text or JSX text that a person reads and that holds a banned word and says what to
  write instead. For the earlier voice it also reports a negative people say short ("do not" for
  "don't") or an unclear contraction ("you'd").

  Only text a person reads is checked. Code is not: an import, a key, a type, a comparison, a
  class name, a test id, an address, an id or a word made of code's marks (`item_id`, `/library`,
  `getContext`), a code sample, or a single lowercase word such as 'item', which is a key. The
  server's own words are its error messages and its notifications; the text meant for models
  (the MCP instructions, tool descriptions and a result's `next`) keeps its words. A result's `say`
  shares src/domain/say.ts with `next`, so tests/server/mcp/say.test.ts checks every `say` the
  tools give against the glossary instead, and the tool titles people read too.

  A banned word may show where the glossary allows it (`allowedOn`): `surfaces` and `appSurfaces`
  say which files make each place. For the earlier glossary the rule warns, and
  scripts/check-plain-words.ts fails a change that adds to the count in plain-words.baseline.json.
  In the web app it is an error: its count starts at zero and stays there.
*/

/** The server's sentences people read, and the demo's fixtures, which the demo shows them. */
export const plainWordsFiles = [
  'src/server/modules/notifications/**/*.ts',
  'db/seed/fixtures/**/*.ts',
]
/** Of the rest of the server, only the messages of the errors it answers with. */
export const errorMessageFiles = ['src/server/**/*.ts']

/**
 * The places a banned word of the earlier glossary may show (`allowedOn` in
 * src/domain/words-v1.ts), each with the files that make it. Their screens left with the earlier
 * front end; the help page that names one stays until the in-app assistant that reads it leaves.
 */
export const surfaces = [{ place: 'the Editions page', files: ['docs/old-help/editions.md'] }]

/** The files whose strings people read in the web app. */
export const appWordsFiles = ['src/app/**/*.{ts,tsx}']
/**
 * Code in the app that is not its own copy: the shadcn and editor parts as they ship, the
 * generated route tree and tests, as the mockup's copy check leaves them out.
 */
export const appNotProductFiles = [
  'src/app/components/ui/**',
  'src/app/components/editor/**',
  'src/app/components/static-renderer/**',
  'src/app/**/*.gen.ts',
  'src/app/**/*.test.{ts,tsx}',
]

/**
 * The places of the app a word of glossary v2 is allowed on, or banned on only (`allowedOn`
 * and `onlyOn` in src/domain/words.ts), each with the files that make it. The paths are the
 * mockup's, under src/app; the pull request that brings a file in keeps its path here in step.
 */
export const appSurfaces = [
  {
    // The connected tool is named on its own integration only.
    place: 'Integrations',
    files: [
      'src/app/pages/integrations.tsx',
      'src/app/model/integrations.ts',
      'src/app/api/mock/data/integrations.ts',
      'src/app/api/mock/data/world.ts',
    ],
  },
  // An edition is Advanced vocabulary: Settings and the agent's reply, never success copy.
  { place: 'Settings', files: ['src/app/pages/settings.tsx'] },
  { place: 'the agent reply', files: ['src/app/lib/agent-reply.ts'] },
  {
    // The review's own sentences, which never name the tool an agent ran in.
    place: 'the review',
    files: ['src/app/pages/review-page.tsx', 'src/app/components/heed/review-parts.tsx'],
  },
]

/** The places of the app that a file makes. */
export function appPlacesOf(path) {
  return appSurfaces
    .filter(({ files }) => files.some((glob) => matchesGlob(path, glob)))
    .map(({ place }) => place)
}

/** The banned words a file may hold: those the glossary allows on the place the file makes. */
export function allowedIn(path) {
  const places = surfaces
    .filter(({ files }) => files.some((glob) => matchesGlob(path, glob)))
    .filter(({ except = [] }) => !except.some((glob) => matchesGlob(path, glob)))
    .map(({ place }) => place)
  return bannedWords
    .filter((banned) => banned.allowedOn && places.some((p) => banned.allowedOn.includes(p)))
    .map((banned) => banned.word)
}

/** Attributes and keys whose value is code, never words: classes, ids, addresses, kinds. */
const codeNames = new Set([
  'action',
  'align',
  'as',
  'autoComplete',
  'class',
  'className',
  'color',
  'dir',
  'enterKeyHint',
  'form',
  'hash',
  'href',
  'htmlFor',
  'icon',
  'id',
  'inputMode',
  'key',
  // Search words: the old names stay findable (voice review, risks 11.3).
  'keywords',
  'aliases',
  'synonyms',
  'kind',
  'lang',
  'layout',
  'method',
  'mode',
  'orientation',
  'path',
  'placement',
  'queryKey',
  'rel',
  'role',
  'side',
  'size',
  'slot',
  'src',
  'srcSet',
  'target',
  'testId',
  'to',
  'tone',
  'type',
  'value',
  'variant',
])
const codeKey = (name) =>
  codeNames.has(name) ||
  name.startsWith('data-') ||
  /^aria-(labelledby|describedby|controls|owns|activedescendant|details|errormessage|flowto)$/.test(
    name,
  ) ||
  /(ClassName|Id|Ids|Key|Href|Url|Path|Variant)$/.test(name)
// A form field's name is code too; elsewhere `name` is often what people read.
const codeAttribute = (name) => name === 'name' || codeKey(name)

/** Calls whose arguments are code: class lists, logs, errors for developers, addresses. */
const codeCalls = new Set(['cn', 'cva', 'clsx', 'cx', 'twMerge', 'require', 'RegExp', 'URL'])
const developerErrors = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError'])
/** Elements that hold code samples. */
const codeElement = /^(code|pre|kbd|samp|var)$|Code|Kbd|Snippet/

const nameOf = (node) =>
  node?.type === 'Identifier' || node?.type === 'JSXIdentifier'
    ? node.name
    : node?.type === 'Literal'
      ? String(node.value)
      : node?.type === 'JSXNamespacedName'
        ? `${node.namespace.name}:${node.name.name}`
        : node?.type === 'MemberExpression'
          ? nameOf(node.property)
          : node?.type === 'JSXMemberExpression'
            ? nameOf(node.property)
            : null

/** The call a node is an argument of, by the callee's name: `cn`, `console.log`, `Error`. */
function calleeName(call) {
  const callee = call.callee
  if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier')
    return callee.object.name === 'console' ? 'console' : nameOf(callee.property)
  return nameOf(callee)
}

/**
 * Whether a string sits where a person reads it, judged by the code around it. `errorsOnly`
 * keeps only the message of an error the server answers with (`new ORPCError(code, { message })`).
 */
function readsAsText(node, errorsOnly) {
  let child = node
  let inMessage = false
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    switch (parent.type) {
      case 'ExportNamedDeclaration':
        if (parent.source === child) return false
        break
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ImportExpression':
      case 'TSLiteralType':
      case 'TSTemplateLiteralType':
      case 'TSEnumMember':
      case 'TSPropertySignature':
      case 'TSImportType':
      case 'TSExternalModuleReference':
      case 'TaggedTemplateExpression':
      case 'SwitchCase':
        return false
      case 'ExpressionStatement': // a directive, such as 'use client'; a call's arguments are text
        if (child === node) return false
        break
      case 'BinaryExpression':
        if (['===', '!==', '==', '!=', 'in'].includes(parent.operator)) return false
        break
      case 'MemberExpression':
        if (parent.property === child) return false
        break
      case 'Property':
      case 'PropertyDefinition':
      case 'MethodDefinition':
        if (parent.key === child) return false
        if (codeKey(nameOf(parent.key) ?? '')) return false
        if (nameOf(parent.key) === 'message') inMessage = true
        break
      case 'JSXAttribute':
        return !errorsOnly && !codeAttribute(nameOf(parent.name) ?? '')
      case 'JSXElement':
        if (codeElement.test(nameOf(parent.openingElement.name) ?? '')) return false
        break
      case 'CallExpression':
      case 'NewExpression': {
        if (child === parent.callee) break
        const name = calleeName(parent)
        if (errorsOnly) return parent.type === 'NewExpression' && name === 'ORPCError' && inMessage
        if (codeCalls.has(name) || developerErrors.has(name) || name === 'console') return false
        break
      }
    }
  }
  return !errorsOnly
}

/** Text with no space that is all lowercase, or made of code's marks, is a key or an id. */
const looksLikeCode = (text) => {
  const trimmed = text.trim()
  return (
    !/\p{L}/u.test(trimmed) ||
    (!/\s/.test(trimmed) && (!/\p{Lu}/u.test(trimmed) || /[^\p{L}\p{N}'’.,!?:;()-]/u.test(trimmed)))
  )
}

/** A key built from a kind and an id, such as `item ${id}`: one lowercase word, then the id. */
const kindAndId = (node) =>
  node.parent.type === 'TemplateLiteral' &&
  node.parent.quasis.length === 2 &&
  /^\p{Ll}+ $/u.test(node.parent.quasis[0].value.cooked ?? '') &&
  node.parent.quasis[1].value.cooked === ''

/** A code sample in a string: JSON, a command line, markup or a function call. */
const codeSample = (text) =>
  /[{[]\s*"[^"]*"\s*:|=>|<\/|\/>|^\s*(\$|npx|npm|claude|curl) /m.test(text)

const plainWords = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Write the words people read in the words of the glossary.' },
    schema: [
      {
        type: 'object',
        properties: {
          errorsOnly: { type: 'boolean' },
          // `app`: glossary v2, for the new web app. Left out: the earlier glossary.
          glossary: { enum: ['app'] },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      appGlossary: 'Instead of "{{found}}", write: {{write}}. See docs/design/copy.md.',
      glossary: 'Instead of "{{found}}", write: {{write}}. See docs/design/voice.md.',
      contraction:
        'Instead of "{{found}}", write "{{write}}", as people say it. Keep "not" in full only where it carries the sentence (fullNegatives in src/domain/words-v1.ts).',
      unclear:
        'Instead of "{{found}}", write it in full: {{write}}. See docs/design/voice.md, principle 5.',
    },
  },
  create(context) {
    const errorsOnly = context.options[0]?.errorsOnly ?? false
    const path = relative(context.cwd, context.filename)
    const toChange =
      context.options[0]?.glossary === 'app'
        ? (text) => {
            const places = appPlacesOf(path)
            return appWordsToChange(text, places).map((c) => ({ ...c, rule: 'appGlossary' }))
          }
        : (text) => wordsToChange(text, allowedIn(path))
    const check = (node, text, whole, isJsx) => {
      if (typeof text !== 'string' || !text.trim()) return
      if (!isJsx && (looksLikeCode(whole) || codeSample(whole))) return
      if (!readsAsText(node, errorsOnly)) return
      // Each word is reported where it stands, so a long text shows which words to change.
      const source = context.sourceCode.getText(node)
      let from = 0
      for (const change of toChange(text)) {
        const at = source.indexOf(change.found, from)
        if (at !== -1) from = at + change.found.length
        const start = node.range[0] + Math.max(at, 0)
        const loc = {
          start: context.sourceCode.getLocFromIndex(start),
          end: context.sourceCode.getLocFromIndex(at === -1 ? node.range[1] : from + node.range[0]),
        }
        context.report({ node, loc, messageId: change.rule, data: change })
      }
    }
    return {
      Literal: (node) => check(node, node.value, node.value, false),
      TemplateElement: (node) => {
        const whole = node.parent.quasis.map((quasi) => quasi.value.cooked ?? '').join('x')
        if (!kindAndId(node)) check(node, node.value.cooked, whole, false)
      },
      JSXText: (node) => check(node, node.value, node.value, true),
    }
  },
}

const plugin = { rules: { 'plain-words': plainWords } }
export default plugin

/**
 * The rule where it applies: on the server's sentences and the demo's fixtures in warn mode until
 * the count is 0 (voice plan V9), in the web app as an error from the start.
 */
export const plainWordsConfigs = [
  {
    files: plainWordsFiles,
    plugins: { heed: plugin },
    rules: { 'heed/plain-words': 'warn' },
  },
  {
    files: errorMessageFiles,
    ignores: plainWordsFiles,
    plugins: { heed: plugin },
    rules: { 'heed/plain-words': ['warn', { errorsOnly: true }] },
  },
  {
    files: appWordsFiles,
    ignores: appNotProductFiles,
    plugins: { heed: plugin },
    rules: { 'heed/plain-words': ['error', { glossary: 'app' }] },
  },
]
