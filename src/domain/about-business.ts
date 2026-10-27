/**
 * About our business: a short text an administrator keeps in Administration, so the assistant and
 * the agents that connect over MCP know what the company does and what its words mean, instead of
 * starting from nothing. It is background, never evidence: it reaches the assistant in its turn
 * context and an agent at the end of the server instructions, after the rules, and never as an
 * item, a source or a tool result, so it is never cited and never shows in a check report.
 */

/** The most characters the text may have, counted as a person reads them. */
export const ABOUT_BUSINESS_MAX = 1200

/**
 * The worked example of the text, an outdoor-gear retailer: what the guide offers to start from
 * (Start from the guide) and what Administration's reset puts back. A new install starts with no
 * text (db/migrations/0010_about_starts_empty.sql); the demo seeds write this one. Neutral on
 * purpose: no company's name, figures or deals, and no legal or regulatory conclusion.
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
 * Exactly what the assistant and agents are given: a line that marks the text as background and
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
 * has to leave the screen (docs/old-help/tell-heed-about-your-business.md says the same at more
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
      hint: 'One per line, as the word, a colon and what it means. For example, First-time buyer: a customer whose first paid order falls in the period. A word that already has a definition in the Catalogue does not need to be repeated here, because this list is for the words people misread in everyday talk.',
    },
  ],
  leaveOut: {
    title: 'Leave out',
    hint: 'numbers, deals, dates and what happened in a market (those are facts, and belong in the library), legal conclusions, and secrets or personal data.',
  },
  /** What leaving the box empty does. */
  empty: 'Leave it empty to give the assistant and agents no background.',
} as const
