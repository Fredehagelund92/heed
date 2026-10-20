import type { Node as ProseNode } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'

/*
  The parts the summary and body editors share: each mention atom is an empty span that React
  fills with the one MentionChip through a portal, and keys read the real caret first.
*/

export type ChipSlot = { id: number; dom: HTMLElement; target: string; label: string }

/** The mention atoms on screen, so React can render a chip into each one. */
export class ChipSlots {
  private slots = new Map<number, ChipSlot>()
  private listeners = new Set<() => void>()
  private snapshot: ChipSlot[] = []
  private next = 0
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getSnapshot = () => this.snapshot
  private changed() {
    this.snapshot = [...this.slots.values()]
    for (const listener of this.listeners) listener()
  }
  add(dom: HTMLElement, node: ProseNode) {
    const id = this.next++
    this.slots.set(id, {
      id,
      dom,
      target: String(node.attrs.target),
      label: String(node.attrs.label),
    })
    this.changed()
    return id
  }
  update(id: number, node: ProseNode) {
    const slot = this.slots.get(id)
    if (!slot) return
    this.slots.set(id, {
      ...slot,
      target: String(node.attrs.target),
      label: String(node.attrs.label),
    })
    this.changed()
  }
  remove(id: number) {
    this.slots.delete(id)
    this.changed()
  }
}

export class MentionView implements NodeView {
  dom: HTMLElement
  private id: number
  private node: ProseNode
  private slots: ChipSlots
  constructor(node: ProseNode, slots: ChipSlots) {
    this.node = node
    this.slots = slots
    this.dom = document.createElement('span')
    this.dom.contentEditable = 'false'
    this.dom.dataset.mention = String(node.attrs.target)
    this.id = slots.add(this.dom, node)
  }
  update(node: ProseNode) {
    if (node.type !== this.node.type) return false
    if (node.attrs.target !== this.node.attrs.target || node.attrs.label !== this.node.attrs.label)
      this.slots.update(this.id, node)
    this.node = node
    this.dom.dataset.mention = String(node.attrs.target)
    return true
  }
  selectNode() {
    this.dom.dataset.selected = 'true'
  }
  deselectNode() {
    delete this.dom.dataset.selected
  }
  // React renders the chip inside; those changes are not edits.
  ignoreMutation() {
    return true
  }
  destroy() {
    this.slots.remove(this.id)
  }
}

export /**
 * Brings the editor's selection up to the browser's caret. The editor hears of a caret moved by
 * the browser (an arrow, Home, End) through the selectionchange event, which can arrive after the
 * next key when keys come fast. A key handled here must see where the caret really is, or an
 * arrow would jump over a chip instead of selecting it, and Backspace would act on a stale place.
 */
function syncSelection(view: EditorView) {
  const { selection } = view.state
  if (!(selection instanceof TextSelection)) return
  const dom = view.dom.ownerDocument.getSelection()
  if (!dom?.anchorNode || !dom.focusNode || !view.dom.contains(dom.anchorNode)) return
  const anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset)
  const head = view.posAtDOM(dom.focusNode, dom.focusOffset)
  if (anchor === selection.anchor && head === selection.head) return
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.between(view.state.doc.resolve(anchor), view.state.doc.resolve(head)),
    ),
  )
}
