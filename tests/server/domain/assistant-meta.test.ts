import { describe, expect, it } from 'vitest'
import {
  aboutTheChat,
  asksAboutChange,
  changeLead,
  changeSubject,
  demoFallback,
  followUpKind,
  followUpReply,
  helpQuestion,
  looksLikeDataQuestion,
  mainPoint,
  metaKind,
  metaReply,
  type FollowUpKind,
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
    'Can my agent change items?',
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

/*
  The captain, 20 October 2026: "Make this clearer: why did average order value drop in
  Netherlands?" was read as a wording question, and "what you mean?" after it ran a brand-new
  lookup on the carried scope. A message about the assistant's own last reply is answered from the
  conversation.
*/
describe("a follow-up on the assistant's last reply", () => {
  it.each<[string, FollowUpKind]>([
    ['what you mean?', 'explain'],
    ['what do you mean?', 'explain'],
    ['What do you mean by that?', 'explain'],
    ['what does that mean', 'explain'],
    ['explain', 'explain'],
    ['Explain that please', 'explain'],
    ['can you explain it again', 'explain'],
    ["I don't understand", 'explain'],
    ['huh?', 'explain'],
    ['say it simpler', 'simpler'],
    ['Can you say that in simpler words?', 'simpler'],
    ['make it simpler', 'simpler'],
    ['in plain english', 'simpler'],
    ['simpler', 'simpler'],
    ['shorter', 'shorter'],
    ['make it shorter please', 'shorter'],
    ['say it in one sentence', 'shorter'],
    ['tl;dr', 'shorter'],
    ['why?', 'why'],
    ['why is that', 'why'],
    ['how come', 'why'],
    ['why did you say that?', 'why'],
    ['how do you know?', 'why'],
  ])('reads %j as %s', (text, kind) => {
    expect(followUpKind(text)).toBe(kind)
  })

  it.each([
    'Why did average order value drop in Netherlands?',
    'why did orders drop',
    'Explain item itm_abcd1234 to me',
    'explain the VAT rate change in the Netherlands',
    'What does GMV mean?',
    'what do you know about orders',
    'Make this clearer: why did average order value drop in Netherlands?',
    'shorter delivery times in Norway',
    'What changed this week?',
    'thanks',
    'hi',
  ])('leaves %j to the tools or to the other kinds', (text) => {
    expect(followUpKind(text)).toBeNull()
  })

  it('is about the chat for a greeting or thanks, and for a follow-up only after an answer', () => {
    expect(aboutTheChat('hi', false)).toBe(true)
    expect(aboutTheChat('thanks!', true)).toBe(true)
    expect(aboutTheChat('what you mean?', true)).toBe(true)
    expect(aboutTheChat('what you mean?', false)).toBe(false)
    expect(aboutTheChat('why?', false)).toBe(false)
    expect(aboutTheChat('Why did orders drop?', true)).toBe(false)
    expect(aboutTheChat('what can you do', true)).toBe(false)
  })

  it('answers from the last reply: its first sentence, no id, no quotation marks, no question about the scope', () => {
    const reply =
      'One fact may be related: the Netherlands switched payment provider on 12 June [itm_0im6wo6d]. It says "a new provider" and no more.'
    for (const kind of ['explain', 'simpler', 'shorter', 'why'] as const) {
      const said = followUpReply(kind, reply, facts)
      expect(said).toContain(
        'One fact may be related: the Netherlands switched payment provider on 12 June.',
      )
      expect(said).not.toMatch(/itm_|["“”]/)
      expect(scopeQuestion.test(said)).toBe(false)
    }
    expect(followUpReply('shorter', reply, facts)).toMatch(/^In short: /)
    expect(followUpReply('simpler', reply, facts)).toMatch(/^Simply put: /)
    expect(followUpReply('explain', reply, facts)).toMatch(/^Let me put it another way\./)
  })

  it('says it has nothing to explain before it has said anything', () => {
    expect(followUpReply('explain', null, facts)).toMatch(
      /^I haven't said anything to explain yet\./,
    )
  })

  it('takes the main point of a reply from its first line of words, past bullets and tables', () => {
    expect(
      mainPoint('**A clearer question names what, where and when.**\n\nName the metric.'),
    ).toBe('A clearer question names what, where and when.')
    expect(mainPoint('- First point here. And more.\n- Second')).toBe('First point here.')
    expect(mainPoint('| a | b |\n| - | - |\nThe table says so.')).toBe('The table says so.')
    expect(mainPoint('  ')).toBeNull()
  })
})

describe('a question about a change, which the facts cannot show', () => {
  it.each([
    'Why did average order value drop in Netherlands?',
    'why was units per order down in June',
    'Did returns rise in Spain last month?',
    'what happened to orders in Norway',
    'Orders fell in Poland',
  ])('reads %j as one', (text) => {
    expect(asksAboutChange(text)).toBe(true)
  })

  it.each([
    'Which facts apply to Orders in Norway last week?',
    'What does the Sandbox domain cover?',
    'What does churn rate mean?',
  ])('leaves %j alone', (text) => {
    expect(asksAboutChange(text)).toBe(false)
  })

  it('says first, in one plain sentence, what the facts cannot show, and claims no cause', () => {
    const subject = changeSubject(['Average order value'], ['Netherlands'])
    expect(subject).toBe('Average order value in the Netherlands')
    expect(changeLead('Why did average order value drop in Netherlands?', subject)).toBe(
      "The facts can't show whether Average order value in the Netherlands dropped, or why.",
    )
    expect(changeLead('Did returns rise in Spain?', 'Returns in Spain')).toBe(
      "The facts can't show whether Returns in Spain rose.",
    )
    expect(changeLead('Why did it fall?', null)).toBe(
      "The facts can't show whether it fell, or why.",
    )
    expect(changeLead('what happened to orders', null)).toBe(
      "The facts can't show whether it changed.",
    )
    expect(changeSubject([], [])).toBeNull()
    expect(changeSubject(['Orders', 'Revenue'], ['Norway', 'Sweden'])).toBe(
      'Orders and Revenue in Norway and Sweden',
    )
  })
})
