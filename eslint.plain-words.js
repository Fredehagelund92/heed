import { matchesGlob, relative } from 'node:path'
import { bannedWords, wordsToChange } from './src/domain/words.ts'

/*
  The words people read follow the voice guide (docs/design/voice.md) and take their names from
  the glossary (src/domain/words.ts). This reports a string, template text or JSX text that a
  person reads and that holds a banned word, a negative people say short ("do not" for "don't")
  or an unclear contraction ("you'd"), and says what to write instead.

  Only text a person reads is checked. Code is not: an import, a key, a type, a comparison, a
  class name, a test id, an address, an id or a word made of code's marks (`item_id`, `/library`,
  `getContext`), a code sample, or a single lowercase word such as 'item', which is a key. The
  server's own words are its error messages and its notifications; the text meant for models
  (the MCP instructions, tool descriptions and a result's `next`) keeps its words. A result's `say`
  shares src/domain/say.ts with `next`, so tests/server/mcp/say.test.ts checks every `say` the
  tools give against the glossary instead, and the tool titles people read too.

  A banned word may show where the glossary allows it (`allowedOn`): `surfaces` says which files
  make each place. The rule warns while the screens are rewritten (voice plan V4 to V7), and
  scripts/check-plain-words.ts fails a change that adds to the count in plain-words.baseline.json.
*/

/** The files whose strings people read. */
export const plainWordsFiles = ['src/web/**/*.{ts,tsx}', 'src/server/modules/notifications/**/*.ts']
/** Of the rest of the server, only the messages of the errors it answers with. */
export const errorMessageFiles = ['src/server/**/*.ts']
/** Code that is not the product: generated tables, stories and the design preview. */
export const notProductFiles = [
  'src/web/routeTree.gen.ts',
  'src/web/**/*.gen.ts',
  'src/web/**/*.stories.tsx',
  'src/web/stories/**',
  'src/web/design-preview/**',
  'src/web/routes/design-preview/**',
]

/**
 * The places a banned word may show (`allowedOn` in src/domain/words.ts), each with the files
 * that make it: its screens and its help page.
 */
export const surfaces = [
  {
    place: 'the Editions page',
    files: [
      'src/web/components/editions/**',
      'src/web/routes/editions/**',
      // The Editions page's sentences. The stop banner every page shows, stopHeadline, never
      // names an edition.
      'src/web/lib/editions.ts',
      'src/web/lib/edition-diff.ts',
      'src/web/lib/edition-compare.ts',
      'docs/help/editions.md',
    ],
  },
  {
    // Only the stamp's line and sentence, where "edition" stands next to the edition id.
    place: 'the review stamp',
    files: ['src/web/components/item/review-stamp.tsx', 'src/web/lib/review-stamp.ts'],
  },
  {
    place: 'the Catalogue',
    files: ['src/web/components/catalogue/**', 'src/web/routes/catalogue/**'],
  },
  {
    place: 'Administration',
    files: [
      'src/web/routes/admin.tsx',
      'src/web/components/gateway/**',
      'src/web/components/settings/**',
      // The words of Limits, the History log, Operations and Sources.
      'src/web/lib/settings.ts',
      'src/web/lib/sources.ts',
    ],
    // A person's own Settings share the folder.
    except: [
      'src/web/components/settings/settings-page.tsx',
      'src/web/components/settings/profile-section.tsx',
      'src/web/components/settings/connect-section.tsx',
    ],
  },
]

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
    docs: { description: 'Write the words people read as the voice guide says.' },
    schema: [
      {
        type: 'object',
        properties: { errorsOnly: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      glossary: 'Instead of "{{found}}", write: {{write}}. See docs/design/voice.md.',
      contraction:
        'Instead of "{{found}}", write "{{write}}", as people say it. Keep "not" in full only where it carries the sentence (fullNegatives in src/domain/words.ts).',
      unclear:
        'Instead of "{{found}}", write it in full: {{write}}. See docs/design/voice.md, principle 5.',
    },
  },
  create(context) {
    const errorsOnly = context.options[0]?.errorsOnly ?? false
    const allowed = allowedIn(relative(context.cwd, context.filename))
    const check = (node, text, whole, isJsx) => {
      if (typeof text !== 'string' || !text.trim()) return
      if (!isJsx && (looksLikeCode(whole) || codeSample(whole))) return
      if (!readsAsText(node, errorsOnly)) return
      // Each word is reported where it stands, so a long text shows which words to change.
      const source = context.sourceCode.getText(node)
      let from = 0
      for (const change of wordsToChange(text, allowed)) {
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

/** The rule where it applies, in warn mode until the count is 0 (voice plan V9). */
export const plainWordsConfigs = [
  {
    files: plainWordsFiles,
    ignores: notProductFiles,
    plugins: { heed: plugin },
    rules: { 'heed/plain-words': 'warn' },
  },
  {
    files: errorMessageFiles,
    ignores: plainWordsFiles,
    plugins: { heed: plugin },
    rules: { 'heed/plain-words': ['warn', { errorsOnly: true }] },
  },
]
