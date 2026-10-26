import * as React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import type { SuggestionProps } from '@tiptap/suggestion'
import { MentionChip, MentionIcon } from '@/components/heed/mention-chip'
import { SuggestList, type SuggestHandle } from '@/components/heed/suggest-list'
import { useMe } from '@/lib/workspace'
import {
  rememberMention,
  searchMentions,
  useMentionables,
  type Mentionable,
  type MentionKind,
} from '@/lib/mentions'
import { EMOJI, rememberEmoji, searchEmoji, type Emoji } from '@/lib/emoji'

// The '@' picker and the ':' picker, both the one list in components/heed/suggest-list.tsx. '@'
// lists Domains, Definitions, Context items, Markets and People with their type icons, recent first;
// each place picks which kinds it offers (lib/mention-extension.ts). ':' and two letters list emoji,
// what was used lately and the five reactions first, and insert the character itself.

export type PickerProps = SuggestionProps<Mentionable, { id: string; label: string }> & {
  kinds: MentionKind[]
  empty: string
  exit: () => void
}
export type PickerHandle = SuggestHandle

export const MentionPicker = React.forwardRef<PickerHandle, PickerProps>(function MentionPicker(
  { query, command, kinds, empty, editor, exit },
  ref,
) {
  const me = useMe()
  const all = useMentionables()
  // You never mention yourself.
  const groups = React.useMemo(
    () =>
      searchMentions(
        all.filter((m) => m.id !== `person:${me.name}`),
        kinds,
        query,
      ),
    [all, kinds, query, me.name],
  )
  const byId = React.useMemo(
    () => new Map(groups.flatMap((g) => g.items).map((m) => [m.id, m])),
    [groups],
  )
  return (
    <SuggestList
      ref={ref}
      label="Mention"
      query={query}
      editor={editor}
      exit={exit}
      groups={groups.map((g) => ({
        label: g.label,
        items: g.items.map((m) => ({
          id: m.id,
          label: m.label,
          hint: m.hint,
          icon: <MentionIcon m={m} className="size-3.5" avatar />,
        })),
      }))}
      onPick={(item) => {
        const m = byId.get(item.id)!
        rememberMention(m.id)
        command({ id: m.id, label: m.label })
      }}
      empty={{
        title: query.trim() ? (
          <>
            Nothing called “<span className="break-all">{query.trim()}</span>”
          </>
        ) : (
          'Nothing to mention yet'
        ),
        line: empty,
      }}
    />
  )
})

export type EmojiPickerProps = SuggestionProps<Emoji, { char: string }> & { exit: () => void }

/** The ':' list: emoji by name or shortcode, the character inserted as plain text. */
export const EmojiPicker = React.forwardRef<PickerHandle, EmojiPickerProps>(function EmojiPicker(
  { query, command, editor, exit },
  ref,
) {
  const groups = React.useMemo(() => searchEmoji(query), [query])
  return (
    <SuggestList
      ref={ref}
      label="Emoji"
      query={query}
      editor={editor}
      exit={exit}
      groups={groups.map((g) => ({
        label: g.label,
        items: g.items.map((x) => ({
          id: `${g.label}:${x.short}`,
          label: x.name,
          hint: `:${x.short}:`,
          // The picture is hidden from screen readers: the row says the name and the shortcode, as it shows them.
          icon: (
            <span aria-hidden className="text-base leading-none">
              {x.char}
            </span>
          ),
        })),
      }))}
      onPick={(item) => {
        const x = EMOJI.find((e) => e.short === item.id.split(':').slice(1).join(':'))!
        rememberEmoji(x.char)
        command({ char: x.char })
      }}
      empty={{ title: `No emoji called “${query}”`, line: 'Type a name, like :thumbs or :tada.' }}
    />
  )
})

/** A mention inside a text box: the shared chip, quiet while editing so the caret stays first. */
export function MentionNode({ node, editor }: NodeViewProps) {
  return (
    <NodeViewWrapper as="span" className="mention-node">
      <MentionChip
        mention={{ id: node.attrs.id as string, label: node.attrs.label as string }}
        interactive={!editor.isEditable}
      />
    </NodeViewWrapper>
  )
}
