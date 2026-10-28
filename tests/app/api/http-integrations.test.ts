import { describe, expect, it } from 'vitest'
import type { SourceActivity, SourceReadEntry, SourceRow, SourceSettings } from '@contract/sources'
import {
  activityOf,
  connectionOf,
  documentOf,
  durationWords,
  everyWords,
  folderOf,
  integrationsOf,
  sourceOf,
  sourcePageOf,
  whenOf,
} from '@/api/http-integrations'

const now = new Date(2026, 9, 23, 10, 0)
const at = (day: number, hour = 6, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString()

const read = (over: Partial<SourceReadEntry> = {}): SourceReadEntry => ({
  id: 'r1',
  at: at(23),
  status: 'ok',
  first: false,
  durationMs: 2_600,
  definitions: null,
  documents: null,
  warnings: [],
  ...over,
})

const row = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: 'cube',
  type: 'cube',
  tool: 'Cube',
  kind: 'definitions',
  name: 'Cube model',
  origin: 'server',
  health: 'healthy',
  schedule: 'PT1H',
  staleAfter: 'PT6H',
  nextReadAt: at(23, 11),
  lastRead: read({ definitions: { seen: 27, added: 0, changed: 0, gone: 0 } }),
  lastGoodAt: at(23),
  failures: 0,
  definitions: { metrics: 22, dimensions: 5, groups: 7, groupsWithoutDomain: 2, flagged: 2 },
  documents: null,
  addedAt: null,
  addedBy: null,
  ...over,
})

const drive = (over: Partial<SourceRow> = {}): SourceRow =>
  row({
    id: 'google-drive',
    type: 'google-drive',
    tool: 'Google Drive',
    kind: 'content',
    name: 'Google Drive',
    origin: 'workspace',
    schedule: 'P1D',
    staleAfter: 'P2D',
    nextReadAt: at(24),
    lastRead: read({
      documents: { seen: 14, suggested: 3, replaced: 1, withdrawn: 0, waiting: 0, skipped: 1 },
      warnings: [{ code: 'document_names_people', count: 1 }],
    }),
    definitions: null,
    documents: { held: 14, waiting: 3, waitingDomains: 2, madeToday: 3, perDay: 5 },
    addedAt: at(1, 9, 30),
    addedBy: 'Ravi Kapoor',
    ...over,
  })

describe('words for times and schedules', () => {
  it('says a moment by its day and time, and how long ago', () => {
    expect(whenOf(at(23), now)).toEqual({ day: 'Today', time: '06:00', ago: '4 hours ago' })
    expect(whenOf(at(23, 11), now)).toEqual({ day: 'Today', time: '11:00' })
    expect(whenOf(at(24), now)).toEqual({ day: 'Tomorrow', time: '06:00' })
    expect(whenOf(at(22), now)).toMatchObject({ day: 'Yesterday', ago: '28 hours ago' })
    expect(whenOf(at(21), now)).toMatchObject({ day: '21 Oct', ago: '2 days ago' })
    expect(whenOf(new Date(2025, 11, 30).toISOString(), now).day).toBe('30 Dec 2025')
  })

  it('says how often and how long in words', () => {
    expect(everyWords('PT1H')).toBe('every hour')
    expect(everyWords('P1D')).toBe('every day')
    expect(everyWords('PT15M')).toBe('every 15 minutes')
    expect(everyWords('PT6H')).toBe('every 6 hours')
    expect(durationWords('PT6H')).toBe('6 hours')
    expect(durationWords('P2D')).toBe('2 days')
    expect(durationWords('PT1H30M')).toBe('90 minutes')
  })
})

describe('a source on its row', () => {
  it('is the catalog tool it reads, with its copy, its last read and its next', () => {
    expect(sourceOf(row(), now)).toEqual({
      id: 'cube',
      connector: 'cube',
      health: 'healthy',
      every: 'every hour',
      staleAfter: '6 hours',
      last: {
        at: { day: 'Today', time: '06:00', ago: '4 hours ago' },
        complete: true,
        seconds: 3,
        seen: 27,
      },
      lastGood: null,
      next: { day: 'Today', time: '11:00' },
      failures: 0,
      failure: null,
      definitions: { metrics: 22, dimensions: 5, views: 7, noDomain: 2, flagged: 2 },
      documents: null,
      created: null,
      inbox: null,
      added: null,
    })
  })

  it('says why a read failed, and when the last good one was', () => {
    const failed = sourceOf(
      row({
        health: 'failed',
        failures: 3,
        lastRead: read({ status: 'failed', warnings: [{ code: 'unreachable', count: 1 }] }),
        lastGoodAt: at(21),
      }),
      now,
    )!
    expect(failed).toMatchObject({
      health: 'failed',
      failures: 3,
      failure: "it couldn't be reached",
      lastGood: { day: '21 Oct', time: '06:00' },
    })
    expect(
      sourceOf(
        row({
          health: 'reauth',
          lastRead: read({ status: 'failed', warnings: [{ code: 'unauthorized', count: 1 }] }),
        }),
        now,
      )!.failure,
    ).toBe('the key was refused')
  })

  it("says what a document tool's read created, waiting for owners in the Inbox", () => {
    expect(sourceOf(drive(), now)).toMatchObject({
      connector: 'google-drive',
      every: 'every day',
      documents: { held: 14, waiting: 3, domains: 2, madeToday: 3, perDay: 5 },
      created: { suggested: 3, replaced: 1, skipped: ['it names people'] },
      inbox: '/inbox',
      added: { by: 'Ravi Kapoor', when: '1 Oct' },
    })
    // Nothing waiting, nothing to open; a read that made nothing created nothing.
    const quiet = sourceOf(
      drive({
        lastRead: read({
          documents: { seen: 14, suggested: 0, replaced: 0, withdrawn: 0, waiting: 0, skipped: 0 },
        }),
        documents: { held: 14, waiting: 0, waitingDomains: 0, madeToday: 0, perDay: 5 },
      }),
      now,
    )!
    expect(quiet).toMatchObject({ created: null, inbox: null })
  })

  it('leaves out a tool the app has no cell for, and offers what the service can connect', () => {
    const view = integrationsOf(
      [row(), row({ id: 'demo', type: 'demo', tool: 'Demo' }), drive()],
      [
        { manifest: { id: 'cube' } },
        { manifest: { id: 'git-markdown' } },
        { manifest: { id: 'static-definitions' } },
      ],
      now,
    )
    expect(view.sources.map((s) => s.id)).toEqual(['cube', 'google-drive'])
    expect(view.connectable).toEqual(['cube', 'markdown-git'])
  })
})

describe("a source's activity", () => {
  it('says what each definitions read did', () => {
    const tool = 'Cube'
    expect(
      activityOf(
        read({ first: true, definitions: { seen: 27, added: 27, changed: 0, gone: 0 } }),
        tool,
        now,
      ),
    ).toEqual({
      when: 'Today, 06:00',
      tone: 'ok',
      what: 'First read',
      detail: '27 definitions added',
    })
    expect(
      activityOf(read({ definitions: { seen: 27, added: 0, changed: 0, gone: 0 } }), tool, now),
    ).toMatchObject({ tone: 'ok', what: 'Read complete', detail: '27 definitions, no changes' })
    expect(
      activityOf(
        read({ at: at(7), definitions: { seen: 27, added: 1, changed: 2, gone: 1 } }),
        tool,
        now,
      ),
    ).toEqual({
      when: '7 Oct, 06:00',
      tone: 'changed',
      what: 'Read complete',
      detail: '2 definitions changed, 1 new, 1 gone',
    })
    expect(
      activityOf(
        read({ status: 'failed', warnings: [{ code: 'unauthorized', count: 1 }] }),
        tool,
        now,
      ),
    ).toMatchObject({ tone: 'failed', what: 'Read refused', detail: 'Cube refused the key.' })
    expect(
      activityOf(read({ status: 'failed', warnings: [{ code: 'timeout', count: 1 }] }), tool, now),
    ).toMatchObject({ tone: 'failed', what: 'Read failed', detail: 'It took too long.' })
  })

  it('says what each document read did', () => {
    const tool = 'Google Drive'
    expect(activityOf(drive().lastRead!, tool, now)).toEqual({
      when: 'Today, 06:00',
      tone: 'changed',
      what: 'Read complete',
      detail: '3 new suggestions, 1 replaced an open one, 1 skipped: names people',
    })
    expect(
      activityOf(
        read({
          first: true,
          documents: { seen: 11, suggested: 4, replaced: 0, withdrawn: 0, waiting: 0, skipped: 0 },
        }),
        tool,
        now,
      ).detail,
    ).toBe('11 documents, 4 suggestions')
    expect(
      activityOf(
        read({
          documents: { seen: 14, suggested: 0, replaced: 0, withdrawn: 0, waiting: 0, skipped: 0 },
        }),
        tool,
        now,
      ),
    ).toMatchObject({ tone: 'ok', detail: '14 documents, no changes' })
  })

  it('says what became of each document, linking a waiting suggestion to its card', () => {
    const doc = (over: Partial<SourceActivity['documents'][number]>) => ({
      title: 'Marketplace orders: what we count',
      link: 'https://docs.example/d/1',
      scope: 'Data team / Definitions',
      domain: 'area_sales',
      state: 'suggested' as const,
      skipReason: null,
      readAt: at(23),
      proposalId: null,
      decidedBy: null,
      ...over,
    })
    expect(documentOf(doc({ proposalId: 'p-1' }), now)).toEqual({
      title: 'Marketplace orders: what we count',
      folder: 'Data team / Definitions',
      domain: 'area_sales',
      state: 'waiting',
      read: 'Today',
      href: '/inbox?card=p-1',
    })
    expect(documentOf(doc({ state: 'returned', decidedBy: 'Tomas Eriksen' }), now)).toMatchObject({
      state: 'returned',
      note: 'Returned by Tomas',
    })
    expect(
      documentOf(doc({ state: 'skipped', skipReason: 'names_people', domain: null }), now),
    ).toEqual({
      title: 'Marketplace orders: what we count',
      folder: 'Data team / Definitions',
      state: 'skipped',
      note: 'Skipped: names people',
      read: 'Today',
    })
    expect(documentOf(doc({ state: 'held', readAt: at(14) }), now)).toMatchObject({
      state: 'held',
      read: '14 Oct',
    })
  })

  it('splits a scope into its folder and path', () => {
    expect(
      folderOf({ id: 'f1', title: 'Data team / Definitions', domain: 'area_sales', documents: 6 }),
    ).toEqual({
      folder: 'Data team',
      path: 'Definitions',
      domain: 'area_sales',
      documents: 6,
    })
    expect(
      folderOf({ id: 'finance', title: 'docs/finance', domain: 'finance', documents: 3 }),
    ).toEqual({
      folder: 'docs/finance',
      path: '',
      domain: 'finance',
      documents: 3,
    })
  })
})

describe('how a source is connected', () => {
  const manifest = {
    config: {
      fields: [
        { key: 'repository', kind: 'address' as const, label: 'Repository' },
        { key: 'ref', kind: 'ref' as const, label: 'Branch or tag' },
        { key: 'folder', kind: 'path' as const, label: 'Folder' },
        { key: 'username', kind: 'text' as const, label: 'User name for the token' },
      ],
    },
    secrets: [{ key: 'token', label: 'Read-only token' }],
  } as unknown as Parameters<typeof connectionOf>[1]
  const settings = (secret: boolean): SourceSettings => ({
    id: 'handbook',
    type: 'git-markdown',
    name: 'Handbook',
    revision: 1,
    config: { repository: 'https://git.example/handbook.git', ref: 'main', folder: '' },
    secrets: [{ key: 'token', set: secret }],
    scopes: [],
    schedule: null,
    nextReadAt: null,
    changedAt: null,
    changedBy: null,
  })

  it('names each setting set, in its connector words, and whether its secret is set, never the secret', () => {
    expect(connectionOf(settings(true), manifest)).toEqual([
      { label: 'Repository', value: 'https://git.example/handbook.git', code: true },
      { label: 'Branch or tag', value: 'main', code: true },
      { label: 'Read-only token', value: 'Set, only used for reading' },
    ])
    expect(connectionOf(settings(false), manifest).at(-1)).toEqual({
      label: 'Read-only token',
      value: 'Not set',
    })
  })

  it("says a server's own source is set where the server runs", () => {
    expect(connectionOf(null, undefined)).toEqual([
      { label: 'Settings', value: 'Set where the server runs, by whoever runs it' },
    ])
  })

  it('says a source just connected reads first soon, with nothing published', () => {
    const page = sourcePageOf(
      drive({ lastRead: null, nextReadAt: null, addedAt: at(23, 9) }),
      { reads: [], groups: [], scopes: [], documents: [] },
      null,
      undefined,
      now,
    )!
    expect(page.activity).toEqual([
      {
        when: 'Today',
        tone: 'ok',
        what: 'Connected',
        detail: 'First read soon. Nothing is published by a read.',
      },
    ])
  })

  it('names the last day a read changed definitions', () => {
    const page = sourcePageOf(
      row(),
      {
        reads: [
          read({ definitions: { seen: 27, added: 0, changed: 0, gone: 0 } }),
          read({ at: at(7), definitions: { seen: 27, added: 0, changed: 2, gone: 0 } }),
        ],
        groups: [{ name: 'orders', metrics: 2, dimensions: 1, domain: 'area_sales' }],
        scopes: [],
        documents: [],
      },
      null,
      undefined,
      now,
    )!
    expect(page.changedOn).toBe('7 Oct')
    expect(page.views).toEqual([
      { view: 'orders', metrics: 2, dimensions: 1, domain: 'area_sales' },
    ])
  })
})
