import { CheckIcon, CircleAlertIcon, TriangleAlertIcon } from '@/components/icons'
import type * as React from 'react'
import { cn } from '@/lib/utils'

// Marked text: colour that means something, and only that (design contract 2.1). One role table for
// the whole app. The colour rides on the ink, the weight and an underline, never on a fill, and it
// always comes with an icon or a word. A name or a term is not marked here: it is a chip.
//
// Mark only text the app wrote itself, from a known place (a state, a label, a phrase it built);
// never search a person's text for words to mark, and never mark a document body or anything agents
// read. Mark the exceptions only: one "needs you" per card or row, at most about three marks in a
// block, and none at all when every row would carry the same one. Kinds, domains, counts and badges
// are never marked.

export type MarkRole = 'needs' | 'differs' | 'wrong' | 'good'

/**
 * The role table: the words' look, and the icon that comes with them, if the role has one.
 * - needs: the one thing to do or look at. Amber ink, a triangle, semibold.
 * - differs: words that differ or changed between two texts. Semibold with a 2 px amber underline;
 *   no icon, so it says "differs" to a screen reader.
 * - wrong: something that failed. Destructive ink, an icon, and the word Failed.
 * - good: something that worked, where that is news. A check and the word.
 */
export const markRoles: Record<
  MarkRole,
  { text: string; icon?: typeof CheckIcon; iconCls?: string }
> = {
  needs: {
    text: 'font-semibold text-caution-text',
    icon: TriangleAlertIcon,
    iconCls: 'text-caution-icon',
  },
  differs: {
    text: 'font-semibold underline decoration-caution-icon decoration-2 underline-offset-3',
  },
  wrong: {
    text: 'font-semibold text-destructive-ink',
    icon: CircleAlertIcon,
    iconCls: 'text-destructive-ink',
  },
  good: { text: 'font-medium text-good-ink', icon: CheckIcon, iconCls: 'text-good-ink' },
}

/** The classes of a role's words, for text that is already its own element (a sentence you can select). */
export const markText = (role: MarkRole) => markRoles[role].text

/**
 * Words with a meaning: "Overlaps live context" as the thing to do, "Failed" as what went wrong.
 * `icon={false}` where the icon already sits beside the words, such as an Inbox row's own triangle.
 */
export function Mark({
  role,
  icon = true,
  children,
  className,
}: {
  role: MarkRole
  icon?: boolean
  children: React.ReactNode
  className?: string
}) {
  const r = markRoles[role]
  const Icon = icon ? r.icon : undefined
  return (
    <mark
      data-mark={role}
      className={cn(
        'bg-transparent text-inherit',
        Icon && 'inline-flex items-baseline gap-1',
        r.text,
        className,
      )}
    >
      {Icon && <Icon aria-hidden className={cn('size-3.5 shrink-0 self-center', r.iconCls)} />}
      {role === 'differs' ? (
        <>
          <span className="sr-only">[differs: </span>
          {children}
          <span className="sr-only">]</span>
        </>
      ) : (
        children
      )}
    </mark>
  )
}
