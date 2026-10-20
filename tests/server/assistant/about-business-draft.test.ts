import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { draftAboutBusiness, type BusinessFacts } from '../../../src/domain/about-business.ts'
import type { Database, Queryable } from '../../../src/server/db/database.ts'
import { writeBusinessDraft } from '../../../src/server/modules/assistant/index.ts'
import { createModelPort, type ModelPort } from '../../../src/server/modules/models/index.ts'

/*
  The first version of About our business, written through the assistant's model: the scripted
  model gives Heed's own draft at no cost, a real model's text must pass the same checks, and a
  model that fails, a text that fails them or a spending limit leaves Heed's own draft. Every call
  is metered under the assistant's feature.
*/

const facts: BusinessFacts = {
  domains: [
    { name: 'Sales', summary: '' },
    { name: 'Marketing', summary: '' },
  ],
  terms: [
    {
      kind: 'metric',
      name: 'Orders',
      aliases: [],
      description:
        'The value of orders customers completed and paid for. Cancelled orders are left out.',
    },
  ],
}
const own = draftAboutBusiness(facts)

/** A database that records what is written to the ledger; the settings are the defaults. */
function fakeDatabase(options: { spentToday?: string } = {}) {
  const queries: string[] = []
  const tx: Queryable = {
    query: (text: string) => {
      queries.push(text)
      if (text.includes('from llm_spend_monthly'))
        return Promise.resolve([
          { total: '0', feature: '0', day: options.spentToday ?? '0', reset: '2026-11-01' },
        ] as never)
      return Promise.resolve([] as never)
    },
  }
  const database = {
    ...tx,
    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
    transaction: <T>(_person: string | null, work: (tx: Queryable) => Promise<T>) => work(tx),
  } as Database
  return { database, tx, queries }
}

const logger = {
  warn: () => {},
  error: () => {},
  info: () => {},
} as never

/** The mock port with the assistant's model replaced. */
function portWith(model: MockLanguageModelV4): { port: ModelPort; calls: () => number } {
  const base = createModelPort({ mode: 'mock' })
  return {
    port: { ...base, choose: (role, ref) => ({ ...base.choose(role, ref), model }) },
    calls: () => model.doGenerateCalls.length,
  }
}
const says = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 50, text: 50, reasoning: 0 },
      },
      warnings: [],
    },
  })

describe('writeBusinessDraft', () => {
  it('with the scripted model gives Heed own draft, through the meter, without cost', async () => {
    const { database, tx, queries } = fakeDatabase()
    const models = createModelPort({ mode: 'mock' })
    const draft = await writeBusinessDraft({ database, models, logger }, tx, 'per_ravi', facts)
    expect(draft).toEqual({ text: own, writtenBy: 'model' })
    expect(queries.some((text) => /insert into/i.test(text))).toBe(true)
  })

  it('is the same text every time', async () => {
    const { database, tx } = fakeDatabase()
    const models = createModelPort({ mode: 'mock' })
    const deps = { database, models, logger }
    expect(await writeBusinessDraft(deps, tx, 'per_ravi', facts)).toEqual(
      await writeBusinessDraft(deps, tx, 'per_ravi', structuredClone(facts)),
    )
  })

  it("uses a real model's text when it passes the checks, in Heed's form", async () => {
    const { database, tx } = fakeDatabase()
    const { port } = portWith(
      says(
        'We sell outdoor gear.\r\n\r\n\r\nWords that are easy to misread here:\r\n- Order: a paid purchase.',
      ),
    )
    expect(
      await writeBusinessDraft({ database, models: port, logger }, tx, 'per_ravi', facts),
    ).toEqual({
      text: 'We sell outdoor gear.\n\nWords that are easy to misread here:\n- Order: a paid purchase.',
      writtenBy: 'model',
    })
  })

  it('sends the facts, and an instruction that rules out numbers, deals and legal conclusions', async () => {
    const { database, tx } = fakeDatabase()
    const model = says('We sell outdoor gear.')
    const { port } = portWith(model)
    await writeBusinessDraft({ database, models: port, logger }, tx, 'per_ravi', facts)
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt)
    expect(prompt).toContain('Never write a digit')
    expect(prompt).toContain('legal or regulatory conclusion')
    expect(prompt).toContain('<business_facts>')
    expect(prompt).toContain('Orders')
  })

  for (const [name, text] of [
    ['a number', 'We sold 40 percent more boots.'],
    ['a legal conclusion', 'Selling this is illegal in Norway.'],
    ['a link', 'See https://example.com for more.'],
    ['too much text', 'x'.repeat(1300)],
    ['no text', ''],
  ] as const)
    it(`falls back to Heed own draft when the model writes ${name}`, async () => {
      const { database, tx } = fakeDatabase()
      const { port } = portWith(says(text))
      expect(
        await writeBusinessDraft({ database, models: port, logger }, tx, 'per_ravi', facts),
      ).toEqual({ text: own, writtenBy: 'facts' })
    })

  it('falls back to Heed own draft when the model cannot be reached', async () => {
    const { database, tx } = fakeDatabase()
    const { port } = portWith(
      new MockLanguageModelV4({
        doGenerate: () => Promise.reject(new Error('provider down')),
      }),
    )
    expect(
      await writeBusinessDraft({ database, models: port, logger }, tx, 'per_ravi', facts),
    ).toEqual({ text: own, writtenBy: 'facts' })
  })

  it('does not call the model past the spending limit', async () => {
    const { database, tx } = fakeDatabase({ spentToday: '999999999' })
    const { port, calls } = portWith(says('We sell outdoor gear.'))
    expect(
      await writeBusinessDraft({ database, models: port, logger }, tx, 'per_ravi', facts),
    ).toEqual({ text: own, writtenBy: 'facts' })
    expect(calls()).toBe(0)
  })

  it('writes nothing, and calls no model, when Heed knows too little', async () => {
    const { database, tx } = fakeDatabase()
    const { port, calls } = portWith(says('We sell outdoor gear.'))
    expect(
      await writeBusinessDraft({ database, models: port, logger }, tx, 'per_ravi', {
        domains: [],
        terms: [],
      }),
    ).toEqual({ text: '', writtenBy: 'facts' })
    expect(calls()).toBe(0)
  })
})
