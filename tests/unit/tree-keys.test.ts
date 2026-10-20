import { describe, expect, it } from 'vitest'
import { treeKeyMove, type TreeKeyItem } from '@/lib/tree-keys'

// Two sections, the first open with two pages, the second closed.
const items: TreeKeyItem[] = [
  { key: 'start', parent: null, branch: true, expanded: true },
  { key: 'what-is-heed', parent: 'start', branch: false, expanded: false },
  { key: 'mcp', parent: 'start', branch: false, expanded: false },
  { key: 'guides', parent: null, branch: true, expanded: false },
]

describe('the keys of the docs tree', () => {
  it('moves down and up through the items shown, and stops at either end', () => {
    expect(treeKeyMove(items, 'start', 'ArrowDown')).toEqual({ focus: 'what-is-heed' })
    expect(treeKeyMove(items, 'mcp', 'ArrowDown')).toEqual({ focus: 'guides' })
    expect(treeKeyMove(items, 'guides', 'ArrowDown')).toBeNull()
    expect(treeKeyMove(items, 'what-is-heed', 'ArrowUp')).toEqual({ focus: 'start' })
    expect(treeKeyMove(items, 'start', 'ArrowUp')).toBeNull()
  })

  it('goes to the first and last item with Home and End', () => {
    expect(treeKeyMove(items, 'mcp', 'Home')).toEqual({ focus: 'start' })
    expect(treeKeyMove(items, 'mcp', 'End')).toEqual({ focus: 'guides' })
  })

  it('opens a closed section with Right, and goes into an open one', () => {
    expect(treeKeyMove(items, 'guides', 'ArrowRight')).toEqual({ expand: 'guides' })
    expect(treeKeyMove(items, 'start', 'ArrowRight')).toEqual({ focus: 'what-is-heed' })
    expect(treeKeyMove(items, 'mcp', 'ArrowRight')).toBeNull()
  })

  it('closes an open section with Left, and goes up from a page to its section', () => {
    expect(treeKeyMove(items, 'start', 'ArrowLeft')).toEqual({ collapse: 'start' })
    expect(treeKeyMove(items, 'mcp', 'ArrowLeft')).toEqual({ focus: 'start' })
    expect(treeKeyMove(items, 'guides', 'ArrowLeft')).toBeNull()
  })

  it('opens and closes a section with Enter and Space, and leaves Enter on a page to its link', () => {
    expect(treeKeyMove(items, 'start', 'Enter')).toEqual({ collapse: 'start' })
    expect(treeKeyMove(items, 'guides', ' ')).toEqual({ expand: 'guides' })
    expect(treeKeyMove(items, 'mcp', 'Enter')).toBeNull()
  })

  it('leaves every other key, and an item it does not know, to the browser', () => {
    expect(treeKeyMove(items, 'start', 'Tab')).toBeNull()
    expect(treeKeyMove(items, 'start', 'j')).toBeNull()
    expect(treeKeyMove(items, 'nowhere', 'ArrowDown')).toBeNull()
  })
})
