import { describe, expect, it } from 'vitest'
import { contentDigest, editionDigest } from '../../../src/domain/canonical.ts'
import {
  EDITION_EXPORT_FORMAT,
  type EditionExport,
  verifyEditionExport,
} from '../../../src/domain/edition-export.ts'
import {
  ITEM_FILE_MAX_ENTRIES,
  offlineFindings,
  readItemFile,
} from '../../../src/domain/item-file.ts'
import { itemVersionDigests } from '../../../src/domain/item-version.ts'
import { termDigestContent } from '../../../src/domain/vocabulary.ts'
import { version } from './fixtures.ts'

const owner = '00000000-0000-4000-8000-000000000002'
const codes = (findings: { code: string }[]) => findings.map((f) => f.code)

describe('item files', () => {
  it('reads a list, or an object with an items list, and keeps the target item', () => {
    const entry = { title: 'Norway closure', summary: 'Closed' }
    expect(readItemFile([entry]).entries).toEqual([
      { index: 0, itemId: null, draft: entry, findings: [] },
    ])
    const file = readItemFile({ format: 'anything', items: [{ ...entry, id: 'itm_abcdefgh01' }] })
    expect(file.error).toBeNull()
    expect(file.entries[0]).toMatchObject({ itemId: 'itm_abcdefgh01', draft: entry })
  })

  it.each([
    [null, 'Expected a list of items'],
    [{ entries: [] }, 'Expected a list of items'],
    [[], 'The file has no items'],
    [Array.from({ length: ITEM_FILE_MAX_ENTRIES + 1 }, () => ({})), 'at most 5000'],
  ])('refuses %j as a file', (document, message) => {
    expect(readItemFile(document).error).toContain(message)
  })

  it('reports entries that are not drafts, with their position, and keeps the others', () => {
    const file = readItemFile([
      'text',
      { id: 'item-1', title: 'x' },
      { title: 'x', unknownField: true },
      { title: 'fine' },
    ])
    expect(file.entries.map((e) => [e.index, codes(e.findings)])).toEqual([
      [0, ['format']],
      [1, ['format']],
      [2, ['format']],
      [3, []],
    ])
    expect(file.entries[1]!.findings[0]!.field).toBe('id')
    expect(file.entries[3]!.draft).toEqual({ title: 'fine' })
  })

  it('reads an exported version back as a draft: identity and digests are the service’s', () => {
    const exported = {
      id: 'itm_abcdefgh01',
      version: 3,
      digest: 'a'.repeat(64),
      ...version({ ownerId: owner }),
    }
    const [entry] = readItemFile([exported]).entries
    expect(entry!.findings).toEqual([])
    expect(entry!.itemId).toBe('itm_abcdefgh01')
    for (const key of ['id', 'version', 'digest', 'proposerId', 'createdVia', 'mentions'])
      expect(entry!.draft).not.toHaveProperty(key)
    expect(entry!.draft).toMatchObject({
      summaryMarkup: 'Online sales stopped in @[Norway](val:market/norway).',
    })
  })

  it('refuses mention rows and plain text that disagree with the markup', () => {
    const exported = version({ ownerId: owner })
    const [rows, text] = readItemFile([
      {
        ...exported,
        mentions: [{ ...exported.mentions[0]!, target: 'val:market/spain' }],
      },
      { ...exported, summary: 'Online sales stopped somewhere else.' },
    ]).entries
    expect(codes(rows!.findings)).toEqual(['mention_rows'])
    expect(codes(text!.findings)).toEqual(['mention_text'])
  })

  it('checks offline what needs no service: sensitive text, mention syntax, fields and limit', () => {
    const [entry] = readItemFile([
      {
        title: 'See @[Orders](metric:orders)',
        summaryMarkup: 'Broken @[mention](group:payments) and password: hunter2',
        bodyMarkup: Array.from({ length: 51 }, () => '@[Orders](metric:orders)').join(' '),
      },
    ]).entries
    expect(codes(offlineFindings(entry!)).sort()).toEqual([
      'mention_field',
      'mention_limit',
      'mention_syntax',
      'password_or_token',
    ])
    expect(offlineFindings(readItemFile([{ title: 'Plain' }]).entries[0]!)).toEqual([])
  })
})

describe('edition export check', () => {
  async function exported(): Promise<EditionExport> {
    const content = version({ ownerId: owner })
    const term = {
      key: 'metric:orders',
      kind: 'metric' as const,
      parentKey: null,
      name: 'Orders',
      aliases: ['Order amount'],
      areaId: 'finance',
      definitionRefs: ['cube:payments.orders'],
    }
    const item = { id: 'itm_abcdefgh01', version: 1, ...content }
    const digests = await itemVersionDigests(content)
    const items = [{ ...item, digest: digests.content }]
    const vocabulary = [{ ...term, digest: await contentDigest(termDigestContent(term)) }]
    const withheld = [{ id: 'itm_grouped0001', digest: 'b'.repeat(64) }]
    const areas = [{ id: 'finance', state: 'live' as const }]
    return {
      format: EDITION_EXPORT_FORMAT,
      edition: {
        seq: 2,
        label: '2026-10-08.1',
        reason: 'proposal_accepted',
        note: null,
        restores: null,
        createdAt: '2026-10-08 12:00:00+00',
        sealedAt: '2026-10-08 12:00:00+00',
      },
      digest: await editionDigest({ items: [...items, ...withheld], vocabulary, areas }),
      items,
      withheld,
      vocabulary,
      areas,
    }
  }

  it('recomputes every digest from the content', async () => {
    expect(await verifyEditionExport(await exported())).toEqual({
      edition: true,
      items: [],
      vocabulary: [],
    })
  })

  it('verifies an export made before a term could name several definitions', async () => {
    const document = await exported()
    const { definitionRefs, ...term } = document.vocabulary[0]!
    // Such a file names the one definition as `definitionRef`.
    const legacy = { ...term, definitionRef: definitionRefs[0] ?? null }
    document.vocabulary = [legacy as unknown as (typeof document.vocabulary)[number]]
    expect(await verifyEditionExport(document)).toEqual({
      edition: true,
      items: [],
      vocabulary: [],
    })
  })

  it('names what was changed after the export', async () => {
    const document = await exported()
    document.items[0]!.title = 'Edited by hand'
    document.vocabulary[0]!.aliases = []
    document.areas[0]!.state = 'paused'
    expect(await verifyEditionExport(document)).toEqual({
      edition: false,
      items: ['itm_abcdefgh01'],
      vocabulary: ['metric:orders'],
    })
  })
})
