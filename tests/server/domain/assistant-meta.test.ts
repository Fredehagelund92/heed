import { describe, expect, it } from 'vitest'
import {
  demoFallback,
  helpQuestion,
  looksLikeDataQuestion,
  metaKind,
  metaReply,
  type MetaKind,
} from '../../../src/domain/assistant-meta.ts'

/*
  Messages about the assistant itself (the captain, 14 October 2026: "what can you do" was
  answered with "Which metric, market and dates do you mean?"). The scripted models read them
  here; a real model answers them from its instructions.
*/

const facts = {
  product: 'Heed',
  name: 'Maria Lindqvist',
  domains: ['Sales', 'Marketing'],
  example: 'Which facts apply to Orders last week?',
}
const scopeQuestion = /\b(?:which|what) (?:metrics?|markets?|dates?)\b[^.?!]*\?/i

describe('a message about the assistant itself', () => {
  it.each<[string, MetaKind]>([
    ['what can you do', 'abilities'],
    ['What can you do?', 'abilities'],
    ['hi', 'greeting'],
    ['Hi there!', 'greeting'],
    ['hello', 'greeting'],
    ['help', 'abilities'],
    ['how does this work?', 'how'],
    ['who are you?', 'identity'],
    ['are you a bot', 'identity'],
    ['thanks!', 'thanks'],
    ['thank you so much', 'thanks'],
    ['tell me a joke', 'outside'],
    ['Can you tell me a funny joke?', 'outside'],
    ['write me a haiku about autumn', 'outside'],
    ["what's the weather in Canada today?", 'outside'],
    ['will it rain tomorrow', 'outside'],
    ['give me a recipe for pancakes', 'outside'],
    ['what is my horoscope', 'outside'],
    ['what is the meaning of life?', 'outside'],
    ['what can I ask you?', 'abilities'],
    ['what do you know about?', 'holdings'],
    ['what domains exist?', 'holdings'],
    ['Which domains are there?', 'holdings'],
    ['list the domains', 'holdings'],
    ['how do I add something?', 'add'],
    ['Good morning! What can you help me with?', 'abilities'],
    ['Hey, what can you do please', 'abilities'],
    ['what is Heed', 'how'],
  ])('reads %j as %s', (text, kind) => {
    expect(metaKind(text)).toBe(kind)
  })

  it.each([
    'Why did revenue go down?',
    'What is this?',
    'Can you help me improve this question: why did revenue go down?',
    'I was just made a deputy owner. What should I look at first?',
    'what do you know about orders',
    'help me write a caveat about orders',
    'The weather closed the stores in Norway: draft a note',
    'Why did orders drop when the weather turned?',
    'What is the GMV forecast definition?',
    // An off-topic word inside a data question is not an off-topic request (the review of PR 180).
    'Which facts apply to orders outside Europe?',
    'Which joke T-shirts launched in the Netherlands?',
    'Rain jacket sales in Norway',
    'snow report feed in the Netherlands',
    'When did the recipe for the discount calculation change?',
    'weather impact on Norway sign-ups',
    'What is the horoscope promo?',
    'What changed in the latest edition?',
    'Which facts apply to orders last week?',
  ])('leaves %j to the tools', (text) => {
    expect(metaKind(text)).toBeNull()
  })

  it('answers each kind plainly: no question about the scope, no quotation marks, no id', () => {
    const kinds: MetaKind[] = [
      'greeting',
      'thanks',
      'identity',
      'abilities',
      'how',
      'add',
      'holdings',
      'outside',
    ]
    for (const kind of kinds) {
      const reply = metaReply(kind, facts)
      expect({ kind, asks: scopeQuestion.test(reply) }).toEqual({ kind, asks: false })
      // A quotation the citation check cannot find in a source is removed before anyone reads it.
      expect(reply).not.toMatch(/["“”]/)
      expect(reply).not.toMatch(/itm_/)
    }
  })

  it('answers a greeting and a thank-you in one short line, and what it can do in three points', () => {
    expect(metaReply('greeting', facts)).toBe(
      'Hi Maria. Try: *Which facts apply to Orders last week?*',
    )
    expect(metaReply('greeting', { ...facts, name: null })).toMatch(/^Hi\. Try: /)
    expect(metaReply('thanks', facts)).toBe("You're welcome.")
    const reply = metaReply('abilities', facts)
    expect(reply).toMatch(/^I help you find, understand and write down facts about your numbers\./)
    expect(reply.match(/^- /gm)).toHaveLength(3)
    expect(reply).toContain('Which facts apply to a metric, a market and dates.')
    expect(reply).toMatch(/Try: \*Which facts apply to Orders last week\?\*$/)
    expect(metaReply('add', facts)).toContain('Add context')
    expect(metaReply('holdings', { ...facts, domains: [] })).toContain('There are no domains yet')
  })

  it('lists the domains with what each is, its facts and owner, and never whether it is live', () => {
    const reply = metaReply('holdings', {
      ...facts,
      lines: [
        'Sales: Orders and revenue, by market. 323 facts, mostly about Orders. Owner: Jon Abara.',
        'Marketing: 280 facts, mostly about Discount cost. Owner: Tomas Eriksen.',
      ],
    })
    expect(reply).toMatch(
      /^There are facts in 2 domains:\n- Sales: Orders and revenue, by market\. 323 facts, mostly about Orders\. Owner: Jon Abara\.\n- Marketing: /,
    )
    expect(reply).not.toMatch(/\blive\b|not started|starting/)
  })

  it('names the product only when asked what it is, and then the one it is given (CL_PRODUCT_NAME)', () => {
    const renamed = { ...facts, product: 'Acme' }
    const kinds = [
      'greeting',
      'thanks',
      'identity',
      'abilities',
      'add',
      'holdings',
      'outside',
    ] as const
    for (const reply of [...kinds.map((kind) => metaReply(kind, renamed)), demoFallback(renamed)])
      expect(reply).not.toMatch(/\b(?:Acme|Heed)\b/)
    expect(metaReply('identity', renamed)).toMatch(/^I'm the assistant here\. /)
    expect(metaReply('how', renamed)).toMatch(/^Acme keeps short facts about your numbers/)
    expect(metaReply('how', renamed)).not.toMatch(/\bHeed\b/)
  })

  it('says it is a demo where it cannot answer, never asking for the scope', () => {
    for (const reply of [metaReply('identity', facts), metaReply('outside', facts)])
      expect(reply).toContain('This is a demo version of me')
    const fallback = demoFallback(facts)
    expect(fallback).toMatch(/^I couldn't match that to a metric, a market or a domain I know\./)
    expect(fallback).toContain('This is a demo version of me')
    expect(scopeQuestion.test(fallback)).toBe(false)
  })
})

describe('a question about how Heed works, which its help pages answer', () => {
  it.each([
    'What is an MCP?',
    'what is an edition',
    'What is a gap?',
    'What does the stop switch do?',
    'what does re-check due mean?',
    'How do I connect Claude Code to Heed?',
    'How do I review a proposal?',
    'Does Heed keep my questions?',
    'Can my AI app change items?',
    'who can see what I write?',
    'Hi, what is an owner please',
  ])('reads %s as one', (text) => {
    expect(helpQuestion(text)).toBe(true)
  })

  it.each([
    'what is GMV?',
    'What does GMV mean?',
    'What is net revenue',
    'What does the Sales domain cover?',
    'how did orders do last week',
    'Which facts apply to Orders in Norway last week?',
    'What changed in the latest edition?',
    'what is this?',
    'who owns the revenue numbers?',
  ])('leaves %s to the data tools', (text) => {
    expect(helpQuestion(text)).toBe(false)
  })
})

describe('a data question', () => {
  it('asks why or how much, names a measure or a period, or points at something', () => {
    for (const text of [
      'Why did revenue go down?',
      'how many customers signed up',
      'What is this?',
      'orders in Norway last week',
      'gross margin in Spain',
    ])
      expect({ text, data: looksLikeDataQuestion(text) }).toEqual({ text, data: true })
    for (const text of ['what can you do', 'zebra', 'good afternoon'])
      expect({ text, data: looksLikeDataQuestion(text) }).toEqual({ text, data: false })
  })
})
