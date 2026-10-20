import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { REQUEST_ROW } from '@/components/mentions/mention-list'
import {
  ENTITY_TYPES,
  pickerStatus,
  useMentionPicker,
  type PickerRow,
  type PickerTrigger,
  type PickerType,
} from '@/components/mentions/mention-picker'
import { buildMentionTargets, type MentionOption } from '@/lib/mention-targets'
import { areas, vocabulary } from '@/mocks/reference-data'

/*
  The @ picker item text and the assistant's question share (FR-129): what each place may offer,
  and the keys that drive the list while the field keeps the focus.
*/

const item: MentionOption = {
  key: 'item:itm_a1b2c3d4',
  type: 'item',
  name: 'Orders excludes test accounts',
  aliases: [],
  detail: 'Note · Sales',
  status: 'current',
  kind: 'note',
}
const retired: MentionOption = {
  ...item,
  key: 'item:itm_e5f6a7b8',
  name: 'Orders double counted in May',
  status: 'retired',
}
const targets = [...buildMentionTargets({ vocabulary, areas }), item, retired]

function usePicker(
  trigger: PickerTrigger | null,
  {
    types = ENTITY_TYPES,
    row,
    onPick = () => {},
  }: {
    types?: readonly PickerType[]
    row?: PickerRow
    onPick?: (option: MentionOption) => void
  } = {},
) {
  return useMentionPicker({
    listId: 'list',
    targets,
    trigger,
    types,
    row: row ? () => row : undefined,
    onPick,
  })
}

const at = (query: string, char: '@' | '#' = '@'): PickerTrigger => ({ at: 4, char, query })

describe('the shared mention picker', () => {
  it('offers every kind of entity, grouped by type, and never a retired item', () => {
    const { result } = renderHook(() => usePicker(at('ord')))
    const types = new Set(result.current.matches.map((match) => match.option.type))
    expect(types).toEqual(new Set(['metric', 'item']))
    expect(result.current.matches.map((match) => match.option.key)).not.toContain(retired.key)
    const { result: domains } = renderHook(() => usePicker(at('sal')))
    expect(domains.current.matches.map((match) => match.option.key)).toContain('area:area_sales')
  })

  it('offers only the types a place allows, and no person until people are a target', () => {
    const terms = renderHook(() => usePicker(at(''), { types: ['metric', 'val', 'dim'] }))
    expect(
      terms.result.current.matches.every((match) =>
        ['metric', 'val', 'dim'].includes(match.option.type),
      ),
    ).toBe(true)
    const people = renderHook(() => usePicker(at('maria'), { types: ['person'] }))
    expect(people.result.current.open).toBe(true)
    expect(people.result.current.matches).toEqual([])
    expect(pickerStatus(people.result.current)).toBe('No match.')
    const values = renderHook(() => usePicker(at('', '#')))
    expect(values.result.current.matches.every((match) => match.option.type === 'val')).toBe(true)
  })

  it('moves with the arrows through the matches and the last row, and Enter takes one', () => {
    const onPick = vi.fn()
    const onChoose = vi.fn()
    const { result } = renderHook(() =>
      usePicker(at('net rev'), { onPick, row: { label: 'Pick dates…', onChoose } }),
    )
    expect(result.current.matches.map((match) => match.option.name)).toEqual(['Net revenue'])
    expect(result.current.activeKey).toBe('metric:net_revenue')
    expect(result.current.activeDescendant).toBe('list-metric-net_revenue')
    act(() => void result.current.keyDown('ArrowDown'))
    expect(result.current.activeKey).toBe(REQUEST_ROW)
    expect(result.current.keyDown('Enter')).toBe('handled')
    expect(onChoose).toHaveBeenCalledOnce()
    act(() => void result.current.keyDown('ArrowDown'))
    expect(result.current.activeKey).toBe('metric:net_revenue')
    act(() => void result.current.keyDown('Tab'))
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'metric:net_revenue' }),
      expect.objectContaining({ query: 'net rev' }),
    )
    // A key the list does not use is the field's.
    expect(result.current.keyDown('a')).toBeNull()
  })

  it('leaves Enter and Tab to the field when there is no row to take', () => {
    const { result } = renderHook(() => usePicker(at('zzzz')))
    expect(result.current.matches).toEqual([])
    expect(result.current.keyDown('Enter')).toBe('empty')
    expect(result.current.keyDown('ArrowDown')).toBe('handled')
  })

  it('closes on Escape for that trigger only, and opens for the next one', () => {
    const initialProps: { trigger: PickerTrigger | null } = { trigger: at('ord') }
    const { result, rerender } = renderHook(({ trigger }) => usePicker(trigger), { initialProps })
    act(() => void result.current.keyDown('Escape'))
    expect(result.current.open).toBe(false)
    expect(result.current.keyDown('ArrowDown')).toBeNull()
    expect(pickerStatus(result.current)).toBe('')
    rerender({ trigger: at('orde') })
    expect(result.current.open).toBe(false)
    rerender({ trigger: null })
    rerender({ trigger: at('ord') })
    expect(result.current.open).toBe(true)
  })

  it('prefers the last row when it asks to', () => {
    const { result } = renderHook(() =>
      usePicker(at('last quarter'), {
        row: { label: 'Dates: 1 Jul to 30 Sep 2026', onChoose: () => {}, preferred: true },
      }),
    )
    expect(result.current.activeKey).toBe(REQUEST_ROW)
  })
})
