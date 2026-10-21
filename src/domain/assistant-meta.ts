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
  'heed|mcps?|editions?|live edition|stop switch|gaps?|owners?|deput(?:y|ies)|approvers?|proposals?|context items?|items?|domains?|health|try it|catalogue|assistant|ai agents?|agents?|ai apps?|tools?|glossary|vocabulary|re ?check due|about our business|docs|help pages?'
const heedWords = `(?:${heedNames})`
const helpForms = [
  // "what is an MCP", "what are proposals", "who is an owner"
  `^(?:what|who) (?:is|are) (?:an? |the )?${heedWords}$`,
  // "what does the stop switch do", "what does re-check due mean"
  `^what does (?:an? |the )?${heedWords} (?:do|mean)$`,
  // "how do I connect Claude Code to Heed", "how does the stop switch work"
  `^how (?:do|can|should|does) (?:i|we|you|heed|an? |the |my )[\\p{L} '-]*\\b(?:${heedNames}|connect|disconnect|review|accept|approve|submit|sign in)\\b`,
  // "does Heed keep my questions", "can my agent change items" ("AI app" is the retired name,
  // and people still type it)
  `^(?:does|do|will|can|is) (?:heed|my ai agent|an ai agent|my agent|an agent|my ai app|an ai app|the assistant|my app) `,
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

/**
 * What a person asks of the assistant's own last reply, in a message that is only that: "what do
 * you mean?", "say it simpler", "shorter", "why?". It reads nothing new from the library, so it is
 * answered from the conversation (`followUpReply`, assistant/prompt.ts, assistant/chat.ts).
 */
export type FollowUpKind = 'explain' | 'simpler' | 'shorter' | 'why'

/** "that", "it" or "this", as a person points back at the last reply. */
const that = '(?:that|it|this)'
const followUps: [FollowUpKind, RegExp][] = [
  [
    'simpler',
    new RegExp(
      [
        `^${ask}(?:please )?(?:say|put|write|explain|tell me)(?: ${that})?(?: again)? (?:more )?(?:simply|simpler|plainly|in (?:simpler|simple|plain|easier|everyday) (?:words|english|terms|language))$`,
        `^${ask}(?:please )?(?:make|keep) ${that} (?:a (?:bit|little) )?(?:more )?(?:simple|simpler|easier|plainer)(?: to (?:read|understand))?$`,
        '^(?:in )?(?:simpler|simple|plain|easier|everyday) (?:words|english|terms|language)$',
        `^(?:simpler|simply|more simply|simplify(?: ${that})?|dumb ${that} down|eli5)$`,
        `^explain(?: ${that})? like i(?:'m| am) (?:five|5)$`,
      ].join('|'),
    ),
  ],
  [
    'shorter',
    new RegExp(
      [
        `^${ask}(?:please )?(?:make|keep) ${that} (?:a (?:bit|little) )?(?:shorter|briefer|short|brief)$`,
        `^${ask}(?:please )?(?:say|put|write)(?: ${that})?(?: again)? (?:in )?(?:shorter|fewer words|one sentence|a few words|short|brief|briefly)$`,
        `^(?:shorter|shorten(?: ${that})?|briefly|be brief|too long|tl dr|tldr|in short|short version|the short version|in one sentence|one sentence|summari[sz]e(?: ${that})?)$`,
      ].join('|'),
    ),
  ],
  [
    'why',
    new RegExp(
      [
        '^(?:why|why (?:is that|is it so|so|that)|how come)$',
        '^why (?:do|did) you (?:say|write|answer|reply) (?:that|so|this)$',
        '^what makes you (?:say|think) (?:that|so)$',
        '^how do you know(?: (?:that|this))?$',
        '^where (?:did|does) (?:that|this) come from$',
        '^says who$',
      ].join('|'),
    ),
  ],
  [
    'explain',
    new RegExp(
      [
        '^(?:what|huh|pardon|come again|eh|sorry what|unclear|not clear)$',
        '^what (?:do|did|does) (?:you|u) mean(?: by (?:that|this|it))?$',
        '^what (?:you|u) mean$',
        `^what (?:does|do) ${that} mean$`,
        `^what is ${that} (?:supposed )?to mean$`,
        "^i (?:do not|don't|dont) (?:understand|get it|get that|follow)(?: (?:that|this|it))?$",
        "^i(?:'m| am) (?:confused|lost)$",
        `^${that} (?:is not|isn't|isnt|was not|wasn't|wasnt) (?:clear|unclear)$`,
        `^${ask}(?:please )?explain(?: ${that})?(?: (?:more|further|again|better))?(?: what you (?:said|meant|wrote))?$`,
        `^${ask}(?:please )?(?:say|tell me) ${that} again$`,
        `^${ask}(?:please )?elaborate(?: on ${that})?$`,
      ].join('|'),
    ),
  ],
]

/** The kind of follow-up about the last reply that this message is, or null when it is more. */
export function followUpKind(text: string): FollowUpKind | null {
  const words = plain(text)
  if (!words) return null
  const forms = [words, bare(words)]
  return followUps.find(([, pattern]) => forms.some((form) => pattern.test(form)))?.[0] ?? null
}

/**
 * Whether a message is about the conversation, not about numbers: a greeting or thanks, or, once
 * the assistant has replied, a follow-up on that reply. It is answered from the conversation with
 * no lookup, so no scope is carried to it, shown for it or bound to it.
 */
export function aboutTheChat(text: string, replied: boolean): boolean {
  const kind = metaKind(text)
  return kind === 'greeting' || kind === 'thanks' || (replied && followUpKind(text) !== null)
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
        `${facts.product} keeps short facts about your numbers that the data doesn't show: a change, a data problem, a definition. People write them, the owner of each domain checks them, and AI agents get the ones that fit their question.`,
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
        'Either way, the owner of its domain checks it before AI agents get it.',
      )
    case 'holdings':
      return paragraphs(domainList(facts), tryIt(facts))
    case 'outside':
      return paragraphs(`That's outside what I help with. ${what} ${tryIt(facts)}`, demo)
  }
}

/** The words of a reply to say again: its first sentence, without ids, quotation marks or bullets. */
export function mainPoint(reply: string): string | null {
  const first = reply
    .replace(/\[\s*itm_[a-z0-9]{8,16}(?:\s*,\s*itm_[a-z0-9]{8,16})*\s*\]/gi, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/[*_`#>]|["“”]/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-+]|\d+\.)\s+/, '').trim())
    .find((line) => line && !line.startsWith('|'))
  const sentence = first ? /^.*?[.!?](?=\s|$)/.exec(first)?.[0] : null
  const point = (sentence || first || '').replace(/\s+/g, ' ').trim()
  return point
    ? [...point].length > 240
      ? `${[...point].slice(0, 237).join('')}...`
      : point
    : null
}

/**
 * The scripted answer to a follow-up on the assistant's last reply (`reply`, its words; null when
 * it has said nothing yet), from the conversation alone: no tool, no scope. A real model explains,
 * simplifies, shortens or gives its reason in its own words; a scripted one says the point of its
 * last reply again and offers to go on.
 */
export function followUpReply(kind: FollowUpKind, reply: string | null, facts: MetaFacts): string {
  const point = reply ? mainPoint(reply) : null
  if (!point) return paragraphs("I haven't said anything to explain yet.", tryIt(facts))
  const more = 'Tell me which part you want explained more.'
  switch (kind) {
    case 'explain':
      return paragraphs(`Let me put it another way. The main point: ${point}`, more)
    case 'simpler':
      return paragraphs(`Simply put: ${point}`, more)
    case 'shorter':
      return `In short: ${point}`
    case 'why':
      return paragraphs(
        `I said that because of the facts and steps above. The main point: ${point}`,
        more,
      )
  }
}

/** The change a question names, as a past-tense verb: "dropped", "rose", else "changed". */
function changeVerb(question: string): string {
  if (/\b(?:fell|fall(?:s|ing|en)?|declin\w*)\b/i.test(question)) return 'fell'
  if (/\b(?:drop(?:s|ped)?|decreas\w*|went down)\b/i.test(question)) return 'dropped'
  if (/\b(?:rose|rise|risen|increas\w*|grew|grow\w*|went up|spik\w*)\b/i.test(question))
    return 'rose'
  return 'changed'
}

const aboutWhy = /\bwhy\b|\bwhat (?:caused|made|drove|explains?)\b/i

/**
 * Whether a question asks if a number changed, or what made it change. The facts are written
 * notes, never the numbers, so they cannot show either, and the answer says so first.
 */
export function asksAboutChange(question: string): boolean {
  return (
    aboutWhy.test(question) ||
    /\b(?:what happened|drop(?:s|ped)?|fell|fall(?:s|ing|en)?|declin\w*|decreas\w*|rose|rise|risen|increas\w*|grew|grow\w*|spik\w*|dip(?:ped)?|went (?:up|down))\b/i.test(
      question,
    )
  )
}

/** The names of places people say with "the": "the Netherlands", "the United Kingdom". */
const withThe = new Set([
  'Bahamas',
  'Czech Republic',
  'Gambia',
  'Maldives',
  'Netherlands',
  'Philippines',
  'Seychelles',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
])

/** What a question about a change is about, by name: "Average order value in the Netherlands". */
export function changeSubject(
  metrics: readonly string[],
  values: readonly string[],
): string | null {
  const what = list([...metrics])
  const where = list(values.map((value) => (withThe.has(value) ? `the ${value}` : value)))
  return what ? (where ? `${what} in ${where}` : what) : where || null
}

/**
 * The first sentence of an answer to a question about a change or its cause: what the facts
 * cannot show, plainly. It claims no cause (assistant/prompt.ts, the truth rules).
 */
export function changeLead(question: string, subject: string | null): string {
  const what = subject || 'it'
  return aboutWhy.test(question)
    ? `The facts can't show whether ${what} ${changeVerb(question)}, or why.`
    : `The facts can't show whether ${what} ${changeVerb(question)}.`
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
