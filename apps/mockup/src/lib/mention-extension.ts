import type * as React from "react"
import { Extension, InputRule } from "@tiptap/core"
import { Mention } from "@tiptap/extension-mention"
import { PluginKey, type EditorState } from "@tiptap/pm/state"
import { ReactNodeViewRenderer, ReactRenderer } from "@tiptap/react"
import { Suggestion, exitSuggestion, type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion"
import { EmojiPicker, MentionNode, MentionPicker, type PickerHandle } from "@/components/heed/mention-picker"
import { fromShortcode, rememberEmoji, type Emoji } from "@/lib/emoji"
import type { MentionKind } from "@/lib/mentions"

// The text box's two lists, one popover and one keyboard model (components/heed/suggest-list.tsx):
// '@' with the shared picker for one place's kinds (the Ask composer, the document editors and the
// comment box), and ':' with two letters for emoji, where people talk to each other (comments, a
// returned suggestion's note, the Ask composer). Context and definitions take no emoji list: agents
// read that text.

const phone = () => window.matchMedia("(max-width: 639px)").matches

/**
 * On a phone the list is a sheet across the width: along the bottom edge when the caret is high on
 * the screen, or resting on the text box when the box itself sits low (the Ask composer), so the
 * words being typed stay in sight.
 */
function placeSheet(el: HTMLElement, caret: DOMRect | null, box: DOMRect) {
  const h = window.innerHeight
  const line = caret ?? box
  const low = line.bottom > h * 0.6
  // A short box (the Ask composer) keeps all of itself in sight; in a long document the caret's line does.
  const top = box.height < 240 ? box.top : line.top
  el.style.bottom = `${low ? h - top + 8 : 0}px`
  el.style.setProperty("--sheet-max", `${Math.max(160, low ? top - 24 : h - line.bottom - 24)}px`)
}

const keys = new Set<PluginKey>()

/** Whether an '@' or ':' list is open in this editor state, so Enter picks rather than sends. */
export const mentionOpen = (state: EditorState) => [...keys].some((k) => (k.getState(state) as { active?: boolean } | undefined)?.active)

/** Either picker: the renderer passes each its own props, so here it is taken as a component of anything. */
type Picker = React.ComponentType<Record<string, unknown>>

/** How either list comes and goes: rendered with React, under the caret or as a sheet on a phone. */
function renderList<I, S>(Component: Picker, key: PluginKey, extra: Record<string, unknown> = {}): SuggestionOptions<I, S>["render"] {
  return () => {
    let renderer: ReactRenderer<PickerHandle, Record<string, unknown>> | undefined
    let unmount: (() => void) | undefined
    const close = () => {
      unmount?.()
      renderer?.destroy()
      renderer = undefined
      unmount = undefined
    }
    let exit = () => undefined as void
    return {
      onStart(props: SuggestionProps<I, S>) {
        exit = () => exitSuggestion(props.editor.view, key)
        renderer = new ReactRenderer<PickerHandle, Record<string, unknown>>(Component, { props: { ...props, ...extra, exit }, editor: props.editor })
        const el = renderer.element as HTMLElement
        el.classList.add("z-50")
        // On a phone the list is a sheet along the bottom; elsewhere it follows the caret.
        if (phone()) {
          el.classList.add("fixed", "inset-x-0")
          placeSheet(el, props.clientRect?.() ?? null, props.editor.view.dom.getBoundingClientRect())
        }
        unmount = props.mount(el, phone() ? { onPosition: () => placeSheet(el, props.clientRect?.() ?? null, props.editor.view.dom.getBoundingClientRect()) } : undefined)
      },
      onUpdate(props: SuggestionProps<I, S>) {
        renderer?.updateProps({ ...props, ...extra, exit })
      },
      onKeyDown(props) {
        if (props.event.key === "Escape") {
          exitSuggestion(props.view, key)
          return true
        }
        return renderer?.ref?.onKeyDown(props.event) ?? false
      },
      onExit: close,
    }
  }
}

export type MentionOptions = {
  kinds: MentionKind[]
  /** The line under "Nothing called ...": what this place can mention. */
  empty: string
}

/** The mention node with the shared picker, for one place's kinds. */
export function mentionExtension({ kinds, empty }: MentionOptions) {
  const key = new PluginKey(`mention-${kinds.join("-")}`)
  keys.add(key)
  return Mention.extend({
    addNodeView() {
      return ReactNodeViewRenderer(MentionNode, { as: "span" })
    },
  }).configure({
    HTMLAttributes: { class: "mention" },
    suggestion: {
      char: "@",
      pluginKey: key,
      allowSpaces: true,
      placement: "bottom-start",
      floatingUi: { strategy: "fixed" },
      items: () => [],
      render: renderList(MentionPicker as unknown as Picker, key, { kinds, empty }),
    },
  })
}

/** ':' then at least two letters or digits, as the list and the closing colon read it. */
const CODE = "[a-z0-9_+-]{2,}"

/**
 * Emoji where people talk to each other: ':' and two letters opens the list, and a shortcode typed
 * out in full (":tada:") turns into its emoji on the closing colon. What goes in is the character
 * itself, plain text. A ':' inside a word or a time (10:30) opens nothing.
 */
export function emojiExtension() {
  const key = new PluginKey("emoji")
  keys.add(key)
  return Extension.create({
    name: "emojiSuggestion",
    addProseMirrorPlugins() {
      return [
        Suggestion<Emoji, { char: string }>({
          editor: this.editor,
          char: ":",
          pluginKey: key,
          allowSpaces: false,
          placement: "bottom-start",
          floatingUi: { strategy: "fixed" },
          allow: ({ state, range }) => new RegExp(`^:${CODE}$`, "i").test(state.doc.textBetween(range.from, range.to)),
          items: () => [],
          command: ({ editor, range, props }) => {
            editor.chain().focus().insertContentAt(range, props.char).run()
          },
          render: renderList<Emoji, { char: string }>(EmojiPicker as unknown as Picker, key),
        }),
      ]
    },
    addInputRules() {
      return [
        new InputRule({
          find: new RegExp(`(^|\\s):(${CODE}):$`, "i"),
          handler: ({ state, range, match }) => {
            const x = fromShortcode(match[2])
            if (!x) return null
            rememberEmoji(x.char)
            state.tr.insertText(x.char, range.from + match[1].length, range.to)
          },
        }),
      ]
    },
  })
}
