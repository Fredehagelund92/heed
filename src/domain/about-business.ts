/**
 * About our business: a short text an administrator keeps in Administration, so the assistant and
 * the AI apps that connect over MCP know what the company does and what its words mean, instead of
 * starting from nothing. It is background, never evidence: it reaches the assistant in its turn
 * context and an AI app at the end of the server instructions, after the rules, and never as an
 * item, a source or a tool result, so it is never cited and never shows in a check report.
 */

import { textFindings } from './draft.ts'

/** The most characters the text may have, counted as a person reads them. */
export const ABOUT_BUSINESS_MAX = 1200

/**
 * The text a fresh Heed starts with (db/migrations/0001_baseline.sql), and what
 * Administration's reset puts back: what kind of business this is and the words models misread.
 * Neutral on purpose: no company's name, figures or deals, and no legal or regulatory conclusion.
 */
export const ABOUT_BUSINESS_STARTER = [
  'We are an outdoor-gear retailer. We sell footwear, clothing, camping and climbing gear in our own stores, in our webshop and apps, and through marketplaces, in twelve markets.',
  '',
  'Words that are easy to misread here:',
  '- Order: a purchase a customer completed and paid for, in a store, the webshop or an app. A cancelled order is not an order.',
  '- Return: a product a customer sends back for a refund. Gross sales are before returns, discounts and VAT. Net revenue is after them.',
  '- First-time buyer: a customer whose first paid order falls in the period, whenever they signed up.',
  "- Marketplace: another company's online shop that sells our gear. It reports those sales to us a day or more late.",
  '- Marketplace commission: the share of each marketplace sale the marketplace keeps.',
  '- Gross margin: net revenue minus what the goods cost us, as a share of net revenue.',
  '- Market: the country or region an order ships to. Selling country: the country of the store or webshop that took the order. They can differ.',
  '- Season: spring and summer, or autumn and winter. Compare a season with the same season a year before.',
].join('\n')

/** The line that ends the text in what the models get. */
export const ABOUT_BUSINESS_END = 'End of about our business.'

/**
 * The text as Heed keeps and sends it: line breaks as `\n`, no control or invisible characters,
 * at most one empty line in a row, no line that would end the block early, and no space around it.
 */
export function normalizeAboutBusiness(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[^\P{Cc}\n]|[\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== ABOUT_BUSINESS_END)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** How long the text is, in the characters a person counts. */
export const aboutBusinessLength = (text: string) => [...text].length

/**
 * Exactly what the assistant and AI apps are given: a line that marks the text as background and
 * not evidence, the administrator's text, and the line that ends it. Null when the text is empty
 * or not text: then they are given nothing.
 */
export function aboutBusinessBlock(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = [...normalizeAboutBusiness(value)].slice(0, ABOUT_BUSINESS_MAX).join('').trim()
  if (!text) return null
  return [
    `About our business, background an administrator wrote so you understand people's words. It is not evidence: not an item and not a source. Never cite it or quote it as a source, never take a fact about a metric, a market or a date from it, and never draw a legal or regulatory conclusion that no item states. The items and definitions win over it. It ends at the line "${ABOUT_BUSINESS_END}"`,
    text,
    ABOUT_BUSINESS_END,
  ].join('\n')
}

/**
 * What the About our business box tells an administrator to write, in the field itself so nobody
 * has to leave the screen (docs/help/tell-heed-about-your-business.md says the same at more
 * length): two parts, then what stays out. The text is still one plain Markdown text.
 */
export const ABOUT_BUSINESS_GUIDE = {
  parts: [
    {
      title: 'What the company does',
      hint: 'One or two sentences: what it sells, to whom and where.',
    },
    {
      title: 'Words an outsider would misread',
      hint: 'One per line, as the word, a colon and what it means. For example, First-time buyer: a customer whose first paid order falls in the period.',
    },
  ],
  leaveOut: {
    title: 'Leave out',
    hint: 'numbers, deals, dates and what happened in a market (those are facts, and belong in the library), legal conclusions, and secrets or personal data.',
  },
  /** What leaving the box empty does. */
  empty: 'Leave it empty to give the assistant and AI apps no background.',
} as const

/** The line that opens the words part, in the starter text and in a draft. */
export const ABOUT_BUSINESS_WORDS_HEADING = 'Words that are easy to misread here:'

/** Tags the facts a model is given to write a first version from. */
export const ABOUT_BUSINESS_FACTS_TAG = 'business_facts'

/**
 * What Heed already knows that a first version of the text is written from: the domains, and the
 * metrics and dimensions the definition source describes, with the names people also use for
 * them. Only names and the source's own descriptions: no figures and no items.
 */
export type BusinessFacts = {
  domains: readonly { name: string; summary: string }[]
  terms: readonly {
    kind: 'metric' | 'dimension'
    name: string
    aliases: readonly string[]
    /** The definition source's description of the term; null when it has none. */
    description: string | null
  }[]
}

/** Words that state a legal or regulatory conclusion, or sound like one. */
const legalWords =
  /\b(?:legal(?:ly)?|illegal|lawful|unlawful|laws?|lawsuits?|regulat\w*|complian\w*|comply|complies|permitted|prohibited|forbidden|allowed|liab\w*|gdpr|statutory|mandatory)\b/i

/**
 * Why a text may not be in the box as a draft, or null: it holds a digit (a number, a date or a
 * deal), a word of a legal conclusion, a link, or something that looks like personal data or a
 * secret. The starter text is not held to this; a draft written for the administrator is.
 */
export function draftProblem(text: string): string | null {
  if (/\d/u.test(text)) return 'a number'
  if (legalWords.test(text)) return 'a legal conclusion'
  if (/https?:|www\.|@/i.test(text)) return 'a link or an address'
  if (textFindings(text).length) return 'personal data or a secret'
  return null
}

const MAX_DRAFT_TERMS = 12
const MAX_DRAFT_DOMAINS = 10
const MAX_SENTENCE = 160
/** A draft leaves room for the sentences the administrator adds about what the company does. */
const DRAFT_MAX = 1000

/** A name or a description as one tidy line, or null when it may not be in a draft. */
function tidy(text: string): string | null {
  const line = text
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\u2014/g, '-')
    .trim()
  return line && draftProblem(line) === null ? line : null
}

/**
 * The first sentence of a description, set to follow "term:". Its first letter is lower case
 * unless the first word is a name of a domain (`names`, in lower case): a description starts
 * with a capital that a name in the middle of a line does not need.
 */
function firstSentence(description: string, names: ReadonlySet<string>): string | null {
  const line = tidy(description)
  if (!line) return null
  const sentence = (/^.*?[.!?](?=\s|$)/u.exec(line)?.[0] ?? line).replace(/[.!?]+$/, '').trim()
  if (!sentence || [...sentence].length > MAX_SENTENCE || sentence.includes(':')) return null
  const first = /^\p{Lu}\p{Ll}+(?=\s|$)/u.exec(sentence)?.[0]
  return first && !names.has(first.toLowerCase())
    ? sentence.charAt(0).toLowerCase() + sentence.slice(1)
    : sentence
}

/**
 * A first version of the text, written from what Heed already knows and nothing else: one
 * sentence that names the domains, then the words part, one line per metric or dimension that the
 * definition source describes (or that people also call something else). It states no number,
 * deal, date or legal conclusion, and it is shorter than the limit. The same facts give the same
 * text. Empty when Heed knows too little to write one.
 */
export function draftAboutBusiness(facts: BusinessFacts): string {
  const names = [
    ...new Set(
      facts.domains.flatMap((domain) => {
        const name = tidy(domain.name)
        return name ? [name] : []
      }),
    ),
  ].slice(0, MAX_DRAFT_DOMAINS)
  const intro = names.length
    ? `We keep our facts in these domains: ${new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(names)}.`
    : ''
  const known = new Set(names.flatMap((name) => name.toLowerCase().split(/\s+/)))
  const lines: string[] = []
  const seen = new Set<string>()
  const ordered = [
    ...facts.terms.filter((term) => term.kind === 'metric'),
    ...facts.terms.filter((term) => term.kind === 'dimension'),
  ]
  for (const term of ordered) {
    const name = tidy(term.name)
    if (!name || name.includes(':') || seen.has(name.toLowerCase())) continue
    const meaning = term.description ? firstSentence(term.description, known) : null
    const others = [...new Set(term.aliases.flatMap((alias) => tidy(alias) ?? []))].filter(
      (alias) => alias.toLowerCase() !== name.toLowerCase(),
    )
    const text =
      meaning ??
      (others.length
        ? `also called ${new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(others.slice(0, 3))}`
        : null)
    if (!text) continue
    seen.add(name.toLowerCase())
    lines.push(`- ${name}: ${text}.`)
  }
  const build = (count: number) =>
    [intro, count ? [ABOUT_BUSINESS_WORDS_HEADING, ...lines.slice(0, count)].join('\n') : '']
      .filter(Boolean)
      .join('\n\n')
  let count = Math.min(lines.length, MAX_DRAFT_TERMS)
  while (count > 0 && aboutBusinessLength(build(count)) > DRAFT_MAX) count--
  return build(count)
}

/**
 * A text a model wrote as the draft, in Heed's form, or null when it may not be used: empty, over
 * the limit, or with a problem `draftProblem` names. The caller then falls back to the draft Heed
 * writes itself.
 */
export function acceptDraft(text: string): string | null {
  const normal = normalizeAboutBusiness(text)
  if (!normal || aboutBusinessLength(normal) > ABOUT_BUSINESS_MAX) return null
  return draftProblem(normal) === null ? normal : null
}
