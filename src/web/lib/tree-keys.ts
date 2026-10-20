/*
  The keys of a tree (the WAI-ARIA tree view pattern), for the docs' tree: what a key does from
  the item that has the focus, given the items shown, in order. Down and Up move to the next and
  previous item, Home and End to the first and last. Right opens a closed branch, or goes into an
  open one; Left closes an open branch, or goes up to the item's branch. Enter and Space open or
  close a branch; on a leaf, which is a link, Enter follows it as a link does.
*/

export type TreeKeyItem = {
  key: string
  /** The branch the item is in, or null at the top. */
  parent: string | null
  /** A branch: it opens and closes. */
  branch: boolean
  expanded: boolean
}

export type TreeKeyMove =
  | { focus: string }
  | { expand: string }
  | { collapse: string }
  /** The key is not the tree's: the browser does what it does. */
  | null

export function treeKeyMove(items: readonly TreeKeyItem[], at: string, key: string): TreeKeyMove {
  const index = items.findIndex((item) => item.key === at)
  const item = items[index]
  if (!item) return null
  switch (key) {
    case 'ArrowDown': {
      const next = items[index + 1]
      return next ? { focus: next.key } : null
    }
    case 'ArrowUp': {
      const previous = items[index - 1]
      return previous ? { focus: previous.key } : null
    }
    case 'Home':
      return { focus: items[0]!.key }
    case 'End':
      return { focus: items.at(-1)!.key }
    case 'ArrowRight': {
      if (!item.branch) return null
      if (!item.expanded) return { expand: item.key }
      const child = items[index + 1]
      return child?.parent === item.key ? { focus: child.key } : null
    }
    case 'ArrowLeft':
      if (item.branch && item.expanded) return { collapse: item.key }
      return item.parent ? { focus: item.parent } : null
    case 'Enter':
    case ' ':
      if (!item.branch) return null
      return item.expanded ? { collapse: item.key } : { expand: item.key }
    default:
      return null
  }
}
