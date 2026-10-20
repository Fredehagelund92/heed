import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from 'react'
import {
  ENTITY_TYPES,
  MentionPickerPopup,
  useMentionPicker,
} from '@/components/mentions/mention-picker'
import { Textarea } from '@/components/ui/textarea'
import { insertToken, mentionToken, triggerBefore, type TextTrigger } from '@/lib/mention-markup'
import type { MentionOption } from '@/lib/mention-targets'
import { useMentionTargets } from '@/lib/use-mention-targets'

const mirrored = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'tabSize',
] as const

/**
 * Where a character of a textarea sits, relative to the textarea's box: an invisible copy of the
 * field holds the text before it, and a marker shows where the next character would go.
 */
function caretPoint(textarea: HTMLTextAreaElement, position: number) {
  const style = getComputedStyle(textarea)
  const copy = document.createElement('div')
  for (const property of mirrored) copy.style[property] = style[property]
  copy.style.position = 'absolute'
  copy.style.visibility = 'hidden'
  copy.style.whiteSpace = 'pre-wrap'
  copy.style.overflowWrap = 'break-word'
  copy.textContent = textarea.value.slice(0, position)
  const marker = document.createElement('span')
  marker.textContent = '​'
  copy.append(marker)
  document.body.append(copy)
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5
  const point = {
    left: marker.offsetLeft - textarea.scrollLeft,
    top: marker.offsetTop - textarea.scrollTop + lineHeight,
  }
  copy.remove()
  return point
}

/**
 * A plain text field for Markdown that inserts mentions as tokens (contract 9.6: the body stays
 * Markdown with Write and Preview; mentions are `@[words](target)` in the text). Typing `@` opens
 * the same list as the summary at the caret, `#` opens it on values; a pick writes the token.
 * The insert goes through the browser's own editing, so the field's undo takes it back.
 */
export function MentionTextarea({
  value,
  onChange,
  onRequestTerm,
  targets: given,
  onKeyDown,
  ...props
}: Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string
  onChange: (text: string) => void
  onRequestTerm?: (words: string) => void
  targets?: MentionOption[]
}) {
  const cached = useMentionTargets()
  const targets = given ?? cached.targets
  const listId = `${useId()}-mentions`
  const ref = useRef<HTMLTextAreaElement>(null)
  const [found, setTrigger] = useState<(TextTrigger & { to: number }) | null>(null)
  const [point, setPoint] = useState<{ left: number; top: number } | null>(null)

  const picker = useMentionPicker({
    listId,
    targets,
    trigger: found && { ...found, at: found.offset },
    types: ENTITY_TYPES,
    row: onRequestTerm
      ? ({ trigger: at, matches }) => {
          const words = at.query.trim()
          return {
            label:
              words && matches.length === 0
                ? `Ask an owner to add “${words}”`
                : 'Not in the list? Ask an owner to add it',
            onChoose: () => {
              onRequestTerm(words)
              picker.dismiss()
            },
          }
        }
      : undefined,
    onPick: (option, trigger) => {
      const field = ref.current
      if (!field) return
      field.focus()
      field.setSelectionRange(trigger.offset, trigger.to)
      const after = field.value.slice(trigger.to)
      const text = mentionToken(option.name, option.key) + (/^[\s.,;:!?)]/.test(after) ? '' : ' ')
      // insertText keeps the field's own undo history; where it is not supported, set the value.
      if (!document.execCommand('insertText', false, text)) {
        const next = insertToken(
          field.value,
          { from: trigger.offset, to: trigger.to },
          option.name,
          option.key,
        )
        onChange(next.text)
        requestAnimationFrame(() => field.setSelectionRange(next.caret, next.caret))
      }
      setTrigger(null)
    },
  })
  const { open, trigger } = picker

  const readTrigger = () => {
    const field = ref.current
    if (!field || field.selectionStart !== field.selectionEnd) return setTrigger(null)
    const caret = field.selectionStart
    const found = triggerBefore(field.value.slice(Math.max(0, caret - 60), caret))
    setTrigger(
      found ? { ...found, offset: caret - (Math.min(caret, 60) - found.offset), to: caret } : null,
    )
  }

  useLayoutEffect(() => {
    const field = ref.current
    if (!open || !field || !found) return setPoint(null)
    setPoint(caretPoint(field, found.offset))
  }, [open, found])

  // With no row to take, Enter and Tab are the field's: a new line, the next field.
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (picker.keyDown(event.key) === 'handled') event.preventDefault()
  }

  return (
    <div className="relative w-full">
      <Textarea
        ref={ref}
        {...props}
        value={value}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-activedescendant={picker.activeDescendant}
        onChange={(event) => {
          onChange(event.target.value)
          picker.reset()
          picker.setActive(null)
          readTrigger()
        }}
        onSelect={readTrigger}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          props.onBlur?.(event)
          setTrigger(null)
        }}
      />
      <MentionPickerPopup
        picker={picker}
        point={point}
        label={
          trigger?.char === '#' ? 'Mention a value' : 'Mention a metric, value, fact or domain'
        }
        closedLabel="Mentions"
      />
    </div>
  )
}
