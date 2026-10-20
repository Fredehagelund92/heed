import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { createMockApi } from '@/api/mock-api'
import { createMockWorkflow } from '@/api/mock-workflow'
import { useAutosaveDraft } from '@/hooks/use-autosave-draft'
import { formValues } from '@/lib/context-form'
import { getFixtureItems } from '@/mocks/fixtures'
import { areas, people, vocabulary, roleGrants, FIXTURE_TODAY } from '@/mocks/reference-data'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
/** `change` opens Suggest a change on an accepted item instead of a new form. */
function setup({ change = false }: { change?: boolean } = {}) {
  const world = createMockWorkflow({
    today: FIXTURE_TODAY,
    areas,
    people,
    vocabulary,
    items: getFixtureItems,
    approvers: roleGrants.approvers,
    administrators: roleGrants.administrators,
  })
  const mock = createMockApi({
    personId: () => 'per_maria',
    workflow: () => Promise.resolve(world),
  })
  const create = vi.spyOn(api, 'createProposal').mockImplementation(mock.createProposal)
  const update = vi.spyOn(api, 'saveDraft').mockImplementation(mock.saveDraft)
  vi.spyOn(api, 'getProposal').mockImplementation(mock.getProposal)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const item = change
    ? getFixtureItems().find((candidate) => candidate.status === 'accepted')
    : null
  const initialValue = formValues(item ?? undefined)
  const onCreated = vi.fn()
  const hook = renderHook(
    ({ value }) =>
      useAutosaveDraft({
        value,
        initialValue,
        itemId: item?.id,
        backupKey: 'test.context',
        onCreated,
      }),
    { initialProps: { value: initialValue }, wrapper },
  )
  return { ...hook, initialValue, mock, create, update, onCreated }
}

it('creates after 800 ms, rebases a comment conflict, and preserves the writer’s text', async () => {
  const h = setup()
  const value = {
    ...h.initialValue,
    areaId: 'area_sales',
    summaryMarkup: 'A reporting issue.',
  }
  h.rerender({ value })
  await tick(799)
  expect(h.create).not.toHaveBeenCalled()
  await tick(1)
  const saved = h.result.current.proposal!
  expect(saved.revision).toBe(1)
  await h.mock.commentOnProposal({
    id: saved.id,
    revision: saved.revision,
    text: 'Please include the source.',
  })
  h.rerender({ value: { ...value, summaryMarkup: 'The revised reporting issue.' } })
  await tick(800)
  expect(h.update).toHaveBeenCalledTimes(2)
  expect(h.result.current.proposal?.draft.summary).toBe('The revised reporting issue.')
  expect(h.result.current.proposal?.revision).toBe(3)
  expect(h.onCreated).toHaveBeenCalledTimes(1)
})

it('keeps edits made while the first create is in flight and never creates a second proposal', async () => {
  const h = setup()
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  h.create.mockImplementation(async (input) => {
    await pending
    return h.mock.createProposal(input)
  })
  const value = { ...h.initialValue, areaId: 'area_sales', summaryMarkup: 'First version.' }
  h.rerender({ value })
  await tick(800)
  h.rerender({ value: { ...value, summaryMarkup: 'Latest version.' } })
  await tick(800)
  await act(async () => {
    release!()
    await pending
  })
  await tick(0)
  expect(h.create).toHaveBeenCalledTimes(1)
  expect(h.result.current.proposal?.draft.summary).toBe('Latest version.')
  expect(h.result.current.unsaved).toBe(false)
})

it('restores unsaved values and does not save a sensitive value on a pending timer', async () => {
  const h = setup()
  const value = { ...h.initialValue, areaId: 'area_sales', summaryMarkup: 'A safe draft.' }
  h.rerender({ value })
  expect(JSON.parse(localStorage.getItem('test.context')!)).toMatchObject({
    summaryMarkup: value.summaryMarkup,
  })
  h.rerender({ value: { ...value, summaryMarkup: 'password=do-not-save-this' } })
  await tick(800)
  expect(h.create).not.toHaveBeenCalled()
  expect(localStorage.getItem('test.context')).not.toContain('do-not-save')
})

it('keeps a backup of a new form only once the person changes it', async () => {
  const h = setup()
  await tick(0)
  // A form as it opened, such as one a capture link filled in, is not kept for next time.
  expect(localStorage.getItem('test.context')).toBeNull()
  h.rerender({ value: { ...h.initialValue, title: 'Reporting delay' } })
  await tick(0)
  expect(JSON.parse(localStorage.getItem('test.context') ?? '{}')).toMatchObject({
    title: 'Reporting delay',
  })
  h.rerender({ value: h.initialValue })
  await tick(0)
  expect(localStorage.getItem('test.context')).toBeNull()
})

it('sends what is wrong with the current version with a change, and clears it when emptied', async () => {
  const h = setup({ change: true })
  h.rerender({ value: { ...h.initialValue, reason: 'The end date is a week late.' } })
  await tick(800)
  expect(h.create.mock.calls[0]![0]).toMatchObject({ reason: 'The end date is a week late.' })
  expect(h.result.current.proposal).toMatchObject({
    action: 'change',
    reason: 'The end date is a week late.',
  })
  h.rerender({ value: { ...h.initialValue, reason: '' } })
  await tick(800)
  expect(h.result.current.proposal?.reason).toBeNull()
})

it('sends no reason with a new item', async () => {
  const h = setup()
  h.rerender({
    value: { ...h.initialValue, areaId: 'area_sales', summaryMarkup: 'A reporting issue.' },
  })
  await tick(800)
  expect(h.create.mock.calls[0]![0]).not.toHaveProperty('reason')
})
