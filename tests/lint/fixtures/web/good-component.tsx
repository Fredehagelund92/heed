// Built from the mockup's scales and the new tokens only: tests/lint/web-guard-rails.test.ts
// expects no message for it as a file of the new app.
import type { CSSProperties } from 'react'

export function Good({ hue, wide }: { hue: number; wide: boolean }) {
  return (
    <section className="flex max-w-wide flex-col gap-1.5 rounded-frame border bg-background px-2.5 md:px-6">
      <header className="sticky top-0 z-raised flex h-bar items-center gap-2 border-b text-sm font-medium">
        3 context items
      </header>
      <span
        className="inline-flex h-6 items-center gap-1 rounded-md bg-chip px-1.5 text-xs text-chip-foreground"
        style={{ '--chip-h': hue } as CSSProperties}
      >
        Orders
      </span>
      <p className="max-w-reading text-base leading-relaxed">Only part of this is written down.</p>
      <div
        className={
          wide
            ? 'mt-4 bg-mark-add decoration-mark-add-line transition-colors duration-(--dur-2) ease-out'
            : 'h-1 origin-left animate-[countdown_2.6s_linear_forwards] bg-primary motion-reduce:animate-none'
        }
      />
    </section>
  )
}
