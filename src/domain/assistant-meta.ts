/**
 * Messages about the assistant itself, not about data: a greeting, thanks, who it is, what it can
 * do, how Heed works, how to add something, what Heed holds, or a request outside Heed (a joke,
 * the weather). A real model answers them from its instructions (assistant/prompt.ts). The two
 * scripted models, the service's (MODELS=mock) and the mock binding's, read them here, so a demo
 * answers them plainly and never with a question about metrics, markets and dates. Where a
 * scripted model cannot answer, it says it is the demo model. Pure text: no input or output.
 */

export type MetaKind =
  'greeting' | 'thanks' | 'identity' | 'abilities' | 'how' | 'add' | 'holdings' | 'outside'

/** The message as one lower-case line, without punctuation. */
const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
/** The same without the greeting and polite words around it: "hi, what can you do please". */
const bare = (words: string) =>
  words
    .replace(
      /^(?:ok(?:ay)? |so |hey |hi |hiya |hello |there |good (?:morning|afternoon|evening|day) |please |um |and )+/,
      '',
    )
    .replace(/(?: please| then| here| in heed| heed| assistant| for me| today)+$/, '')

/** "Can you ", "could you " or nothing, before a request. */
const ask = '(?:(?:can|could|will|would) you )?'

const kinds: [MetaKind, RegExp][] = [
  [
    'greeting',
    /^(?:hi|hello|hey|hiya|howdy|yo|hej|hallo|good (?:morning|afternoon|evening|day)|hi there|hello there|how are you(?: doing)?|how's it going)$/,
  ],
  [
    'thanks',
    /^(?:(?:great |ok |perfect |cool |nice )?(?:thanks?|thank you|thx|ty|cheers|much appreciated)(?: (?:a lot|so much|very much|again))?|great|perfect|cool|nice|got it|ok|okay|bye|goodbye)$/,
  ],
  [
    'identity',
    /^(?:who|what) are you|^are you (?:a |an )?(?:bot|robot|ai|human|real|person|chatgpt|claude|gpt|model)$|^what (?:ai |language )?model are you|^who (?:made|built|created) you$|^what(?:'s| is) your name$/,
  ],
  [
    'abilities',
    /^(?:help|help me|i need help|can you help(?: me)?|how can you help(?: me)?|what can you do|what do you do|what can you help(?: me)? with|what are you (?:for|good at|able to do)|what are your (?:capabilities|abilities|skills)|what can i (?:ask|do)(?: you)?|what (?:should|could) i ask(?: you)?|what (?:kind of |sort of )?(?:questions|things) can (?:i ask(?: you)?|you answer)|what do i ask|options|menu|commands)$/,
  ],
  [
    'how',
    /^(?:how does (?:this|it|heed|this (?:app|tool|thing|assistant|chat)) work|how do (?:i|you) use (?:this|it|heed|you|the assistant)|how do i (?:start|begin|get started)|getting started|what is heed|what's heed|what is this (?:app|tool|place|page)|explain heed|tell me about heed)$/,
  ],
  [
    'add',
    /^how (?:do|can|should) i (?:add|write|create|submit|record|propose|suggest|contribute)(?: (?:something|a fact|facts|context|an item|items|a context item|a caveat|a note|a change|it|one|mine))?(?: (?:to|in|into) heed)?$/,
  ],
  [
    'holdings',
    /^what (?:do you|does heed) (?:know|hold|have|cover)(?: about)?$|^what do you know$|^what(?:'s| is) in heed$|^what (?:data|context|facts|domains) (?:do you|does heed) (?:have|hold|know about)$|^(?:what|which) domains (?:are there|exist|do (?:you|we) have|does heed have)$|^what are the domains$|^(?:list|show)(?: me)? (?:the |all |all the )?domains$/,
  ],
  // The whole message is the request, never a word in it: "rain jacket sales in Norway" and
  // "when did the recipe for the discount calculation change" are data questions.
  [
    'outside',
    new RegExp(
      [
        `^${ask}(?:tell|give|share|make up)(?: me| us)? (?:a |another |some |any )?(?:good |funny )?(?:jokes?|riddles?)(?: about [\\p{L} ]+)?$`,
        `^(?:do you know|know) (?:a|any) (?:good |funny )?(?:jokes?|riddles?)$`,
        `^${ask}(?:write|compose|make|give|tell|sing)(?: me| us)? (?:a |an |another )?(?:short |little |funny )?(?:poem|song|haiku|limerick)(?: (?:about|for|on) [\\p{L} ]+)?$`,
        `^(?:(?:what's|what is|how's|how is) )?the weather(?: forecast)?(?: like)?(?: (?:in|at|for) [\\p{L} ]+?)?(?: (?:today|tomorrow|tonight|now|right now|this week|this weekend))?$`,
        `^(?:will|is) it (?:going to )?(?:rain|snow|be sunny|be cold|be warm)(?: [\\p{L} ]+)?$`,
        `^${ask}(?:give|tell|share|find|send)(?: me)? (?:a |the |your )?(?:good |best )?recipe (?:for|of) [\\p{L} ]+$`,
        `^${ask}(?:tell me |read |give me |what's |what is )?(?:my |today's )?horoscope(?: for [\\p{L} ]+)?$`,
        `^(?:what's|what is) the meaning of life$`,
      ].join('|'),
      'u',
    ),
  ],
]

/** The words of Heed's own screens and pages: what a question about how Heed works names. */
const heedNames =
  'heed|mcps?|editions?|live edition|stop switch|gaps?|owners?|deput(?:y|ies)|approvers?|proposals?|context items?|items?|domains?|health|try it|catalogue|assistant|ai apps?|tools?|glossary|vocabulary|re ?check due|about our business|docs|help pages?'
const heedWords = `(?:${heedNames})`
const helpForms = [
  // "what is an MCP", "what are proposals", "who is an owner"
  `^(?:what|who) (?:is|are) (?:an? |the )?${heedWords}$`,
  // "what does the stop switch do", "what does re-check due mean"
  `^what does (?:an? |the )?${heedWords} (?:do|mean)$`,
  // "how do I connect Claude Code to Heed", "how does the stop switch work"
  `^how (?:do|can|should|does) (?:i|we|you|heed|an? |the |my )[\\p{L} '-]*\\b(?:${heedNames}|connect|disconnect|review|accept|approve|submit|sign in)\\b`,
  // "does Heed keep my questions", "can my AI app change items"
  `^(?:does|do|will|can|is) (?:heed|my ai app|an ai app|the assistant|my app) `,
  // "who can see what I write", "who reviews a proposal"
  '^who (?:can|reviews|decides|accepts|approves|sees) ',
].join('|')
const helpForm = new RegExp(helpForms, 'u')

/**
 * Whether a message asks how Heed itself works, which Heed's help pages answer (search_help):
 * what one of its words means, how to do something in it, or what it does with what people write.
 * A data question ("what is GMV", "what does the Sales domain cover") is not one.
 */
export function helpQuestion(text: string): boolean {
  const words = plain(text)
  return [words, bare(words)].some((form) => helpForm.test(form))
}

/** Words that tie a message to Heed's context: "The weather closed the stores: draft a note". */
const heedCue = /\b(?:draft|note|caveat|items?|facts?|context|propose|definition|mean|means)\b/

/** What kind of meta message this is, or null for a message about Heed's context or data. */
export function metaKind(text: string): MetaKind | null {
  const words = plain(text)
  if (!words) return null
  const forms = [words, bare(words)]
  const kind = kinds.find(([, pattern]) => forms.some((form) => pattern.test(form)))?.[0] ?? null
  // "Why did orders drop when the weather turned?" is about data, whatever it mentions.
  if (
    kind === 'outside' &&
    (heedCue.test(words) ||
      looksLikeDataQuestion(words.replace(/\b(?:it|this|that|these|those|today)\b/g, '')))
  )
    return null
  return kind
}

/**
 * Whether a message reads as a question about numbers or facts, so a question back for the
 * metric, market or dates it lacks is fair: it asks why or how much, names a change, a common
 * measure or a period, or points at something ("this", "it").
 */
export function looksLikeDataQuestion(text: string): boolean {
  return /\b(?:why|how (?:much|many)|went|go(?:es|ne)? (?:up|down)|drop(?:ped|s)?|r[io]se|fell|fall(?:en|ing)?|spike|dip|increase|decrease|grow|grew|declin|number|numbers|figures?|total|trend|compare|revenue|orders?|sales|units|customers?|margin|gmv|kpi|metric|market|last (?:week|month|year|quarter)|this (?:week|month|year|quarter)|yesterday|today|q[1-4]|\d{4}|this|that|these|those|it)\b/i.test(
    text,
  )
}

/** What a scripted model knows of the install for its answer: all optional. */
export type MetaFacts = {
  /** The product's name (src/domain/brand.ts), for who the assistant is and what it covers. */
  product: string
  /** The person's name, to greet them by. */
  name?: string | null
  /** The domains of the live edition, by name. */
  domains: string[]
  /**
   * One line per domain, as the turn context gives it: what the domain is, how many items it
   * holds and its owner. Never whether it is live: every domain is served.
   */
  lines?: string[]
  /** A question this install can answer, to try (no quotation marks: they are for sources). */
  example: string
}

const list = (names: string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/** What the assistant does, in one sentence: the voice review's own words (section 7.3). */
const what = 'I help you find, understand and write down facts about your numbers.'
const can = [
  '- What a metric means, and what to know before you trust it.',
  '- Which facts apply to a metric, a market and dates.',
  '- Help writing a new fact, which the owner of its domain then checks.',
]
/** A scripted model says once, where it can't answer as a real one would, that it is the demo. */
const demo =
  'This is a demo version of me: I follow a few set phrasings, so my answers are simpler.'
const domainCount = (n: number) => (n === 1 ? 'one domain' : `${n} domains`)
const holds = (facts: MetaFacts) =>
  facts.domains.length
    ? `There are facts in ${domainCount(facts.domains.length)}: ${list(facts.domains)}.`
    : "There are no domains yet, so there's nothing to look up."
/** The domains, one line each, when the scripted model was given them; else their names. */
const domainList = (facts: MetaFacts) =>
  facts.lines?.length
    ? [
        `There are facts in ${domainCount(facts.lines.length)}:`,
        ...facts.lines.map((line) => `- ${line}`),
      ].join('\n')
    : holds(facts)
/** A question to try, in italics: the person's own words to send, never a quotation. */
const tryIt = (facts: MetaFacts) => `Try: *${facts.example}*`

/** Paragraphs, a blank line apart; the list of what it can do is one of them. */
const paragraphs = (...parts: string[]) => parts.join('\n\n')
const abilities = can.join('\n')

/**
 * The scripted answer to a meta message, in the voice of docs/design/voice.md: a greeting or a
 * thank-you gets one short line, "what can you do" three points, and nothing names the product
 * unless the person asked what it is. No tool, and no question about the scope.
 */
export function metaReply(kind: MetaKind, facts: MetaFacts): string {
  switch (kind) {
    case 'greeting':
      return `${facts.name ? `Hi ${facts.name.split(' ')[0]}.` : 'Hi.'} ${tryIt(facts)}`
    case 'thanks':
      return "You're welcome."
    case 'identity':
      return paragraphs(`I'm the assistant here. ${what}`, demo)
    case 'abilities':
      return paragraphs(`${what} For example:`, abilities, tryIt(facts))
    case 'how':
      return paragraphs(
        `${facts.product} keeps short facts about your numbers that the data doesn't show: a change, a data problem, a definition. People write them, the owner of each domain checks them, and AI apps get the ones that fit their question.`,
        `In this chat, ${what}`,
        tryIt(facts),
      )
    case 'add':
      return paragraphs(
        [
          'You can add a fact in two ways:',
          '- Open **Add context** and fill it in yourself.',
          "- Or tell me what happened, where it applies, from when, and how you know (a link and a short quote). I'll draft it for you to check and send.",
        ].join('\n'),
        'Either way, the owner of its domain checks it before AI apps get it.',
      )
    case 'holdings':
      return paragraphs(domainList(facts), tryIt(facts))
    case 'outside':
      return paragraphs(`That's outside what I help with. ${what} ${tryIt(facts)}`, demo)
  }
}

/**
 * The scripted answer when a message names nothing Heed knows and reads as no data question: said
 * plainly, never a question about metrics, markets and dates the person never meant to ask.
 */
export function demoFallback(facts: MetaFacts): string {
  return paragraphs(
    `I couldn't match that to a metric, a market or a domain I know. ${demo}`,
    tryIt(facts),
  )
}
