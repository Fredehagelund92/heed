import { describe, expect, it } from 'vitest'
import { productName } from '../../../src/server/brand.ts'
import {
  readText,
  toneProblems,
  toneShortfalls,
  toneSummary,
} from '../../../src/server/modules/assistant/tone.ts'

/*
  The tone check of every assistant test run (the voice review, section 7.5): the old voice it
  measured is flagged, the target voice passes, and what the person or a fact said first may be
  said back. The befores are real answers from the review's runs; the afters are its targets.
*/

describe('the tone check', () => {
  it('flags the old voice the review measured', () => {
    const before =
      'I help you understand, write and improve context items. These are short governed facts that analytics agents receive with their data. I never submit, accept, publish, retire or edit items.'
    expect(toneProblems(before, ['what can you do'])).toEqual([
      'said "context item": write fact',
      'said "item": write fact',
      'said "agent": write AI app',
      'said "governed": write checked',
      'said "retire": write archive',
    ])
    const machinery =
      '**I could not find a fact for this scope.** Edition 2026-10-07.2 has nothing that applies to Orders, France: get_context returned no_match for itm_0a1b2c3d.'
    expect(toneProblems(machinery, ['anything about orders in france?'])).toEqual([
      'said "scope": write where it applies',
      'said "edition": write what AI apps get today',
      'said "no_match": write nothing is written down for this',
      'named the tool get_context',
      'showed an edition label',
      "showed a fact's id outside a citation",
    ])
    expect(toneProblems('It applies from 2026-06-15 [itm_0a1b2c3d].', ['and when?'])).toEqual([
      'showed an ISO date',
    ])
  })

  it('passes the six example replies of the instructions', () => {
    for (const [said, reply] of [
      [
        'what does Net sales mean?',
        "Net sales is another name for Net revenue. Cube defines it as 'net sales after discounts'. One fact about it applies today: Spain's figures are incomplete until the files arrive [itm_0a1b2c3d].",
      ],
      [
        'is the revenue number in this weeks exec pack right',
        'Mostly, yes. One thing to know: Spain is missing two days of payments [itm_0a1b2c3d]. I read this as Net revenue for 5 to 11 October. Tell me if you meant a different revenue.',
      ],
      [
        'need a caveat up before monday: units sold in poland is double counted 3-9 oct',
        "Here's the draft to confirm. I filled in Units sold, Poland, 3 to 9 October, the link and the quote from your message. Once it's saved, check it and send it for review.",
      ],
      [
        'anything I should know about orders in France last month?',
        'Nothing is written down for orders in France in September. Nobody has added a fact about it yet. If you know of something, I can help you write it down.',
      ],
      ['thanks!', "You're welcome."],
      [
        'why was units per order down in the Netherlands in June?',
        "One fact may explain part of it: the Netherlands switched payment provider on 12 June [itm_0a1b2c3d]. The fact doesn't prove it caused the drop. To check, compare the Netherlands with a market that kept its provider.",
      ],
    ] as const)
      expect(toneProblems(reply, [said]), reply).toEqual([])
  })

  it('lets the person, a fact or a quotation say a word first', () => {
    expect(
      toneProblems('The latest edition added 5 facts.', ['What changed in the latest edition?']),
    ).toEqual([])
    // A word from an earlier turn of the conversation counts too.
    expect(
      toneProblems('That owner is Jon Abara.', ['who is the owner of Commercial?', 'and?']),
    ).toEqual([])
    const read = readText([
      { items: [{ id: 'itm_0a1b2c3d', title: 'Marketplace agent fees changed' }] },
    ])
    expect(toneProblems('Marketplace agent fees changed [itm_0a1b2c3d].', ['fees?'], read)).toEqual(
      [],
    )
    // The page's words, in quotation marks, are the page's.
    expect(toneProblems('The page says "the scope of the ban widens on 1 May".', ['and?'])).toEqual(
      [],
    )
    // Field names in a tool result are never words a fact said.
    expect(readText([{ owner: 'Jon', scope: { metrics: [] } }])).toBe('')
  })

  it('wants a short line back for thanks and a greeting, and at most four points for what it can do', () => {
    const menu = [
      "You're welcome, Frederik. I can help you in four ways:",
      '- **Explain** what a metric means.',
      '- **Check** what applies.',
      '- **Help you write** a fact.',
      '- **Find gaps**.',
    ].join('\n')
    expect(toneProblems(menu, ['thanks!'])).toEqual(['answered a thanks with a list'])
    expect(
      toneProblems(`${menu} ${'Ask me anything about your numbers. '.repeat(2)}`, ['thanks!']),
    ).toEqual(['answered a thanks in 37 words (at most 25)', 'answered a thanks with a list'])
    expect(toneProblems(`${menu}\n- **Sharpen** a question.`, ['what can you do?'])).toEqual([
      'listed 5 things it can do (at most 4)',
    ])
    expect(
      toneProblems('Hi Maria. Try: *Which facts apply to Orders last week?*', ['hello']),
    ).toEqual([])
  })

  it('wants no sentence over 30 words', () => {
    const long = `This is ${'a very '.repeat(14)}long sentence.`
    expect(toneProblems(long, ['why?'])).toEqual([
      `wrote a sentence of 32 words (at most 30): "${long.slice(0, 80)}"`,
    ])
  })

  it('names the product only when the person names it or asks what it is', () => {
    expect(toneProblems(`${productName} holds 300 facts.`, ['what do you hold?'])).toEqual([
      `named ${productName}, which the person did not ask about`,
    ])
    expect(toneProblems(`${productName} keeps short facts.`, [`what is ${productName}?`])).toEqual(
      [],
    )
    expect(toneProblems(`${productName} keeps short facts.`, ['how does this work?'])).toEqual([])
  })

  it('sums up a run against the review bars: short sentences, and "you" or "I" in half the answers', () => {
    const summary = toneSummary([
      { answer: "You're welcome.", problems: 0 },
      { answer: 'Nothing is written down for that. I can help you write it down.', problems: 0 },
      { answer: 'Edition 2026-10-07.2 has nothing.', problems: 2 },
    ])
    expect(summary).toEqual({
      answers: 3,
      meanSentenceWords: 4.8,
      longestSentenceWords: 7,
      personal: 2,
      flagged: 1,
    })
    expect(toneShortfalls(summary)).toEqual([])
    expect(toneShortfalls({ ...summary, meanSentenceWords: 21, personal: 1 })).toEqual([
      'sentences average 21 words (at most 16)',
      'only 1 of 3 answers say "you" or "I"',
    ])
  })
})
