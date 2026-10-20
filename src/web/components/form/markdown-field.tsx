import { useState } from 'react'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { FieldControl, FieldCounter, FieldError, FieldFooter } from '@/components/ui/field'
import { Markdown, type MentionRenderer } from '@/components/form/markdown'
import { cn } from '@/lib/utils'

/**
 * A plain Markdown text field with a Write and a Preview tab above it. Preview draws the safe
 * subset of `Markdown`; nothing renders while typing. Item text does not use it: the item form
 * writes its body in the page editor (`components/editor`, contract 9.6). The write area stays mounted on Preview, so undo history
 * and the caret survive a switch. Put it inside a `Field` with its label; the counter and the
 * error sit under the box.
 */
export function MarkdownField({
  value,
  onValueChange,
  max,
  error,
  placeholder,
  disabled = false,
  name,
  renderMention,
  defaultTab = 'write',
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  /** The most characters the text may hold. The counter turns red above it. */
  max: number
  error?: string
  placeholder?: string
  disabled?: boolean
  name?: string
  renderMention?: MentionRenderer
  defaultTab?: 'write' | 'preview'
  className?: string
}) {
  const [tab, setTab] = useState<'write' | 'preview'>(defaultTab)
  const length = [...value].length
  return (
    <div data-slot="markdown-field" className={cn('flex flex-col gap-2', className)}>
      <TabsPrimitive.Root
        value={tab}
        onValueChange={(next: 'write' | 'preview') => setTab(next)}
        className={cn(
          'flex min-w-0 flex-col overflow-hidden rounded-md border border-input bg-background has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-ring has-[textarea[aria-invalid=true]]:border-destructive dark:bg-input/30',
          disabled && 'opacity-50',
        )}
      >
        <TabsPrimitive.List
          aria-label="Write or preview"
          className="flex h-tabs shrink-0 items-stretch gap-4 border-b border-border px-3"
        >
          {(['write', 'preview'] as const).map((id) => (
            <TabsPrimitive.Tab
              key={id}
              value={id}
              className="relative inline-flex items-center text-dense font-bold text-muted-foreground -outline-offset-2 transition-colors duration-instant after:absolute after:inset-x-0 after:bottom-0 after:h-0 after:border-t-2 after:border-foreground after:opacity-0 hover:text-foreground data-active:text-foreground data-active:after:opacity-100"
            >
              {id === 'write' ? 'Write' : 'Preview'}
            </TabsPrimitive.Tab>
          ))}
        </TabsPrimitive.List>
        <TabsPrimitive.Panel value="write" keepMounted className="flex data-hidden:hidden">
          <FieldControl
            name={name}
            disabled={disabled}
            value={value}
            onValueChange={(next) => onValueChange(String(next))}
            render={
              <textarea
                data-slot="markdown-field-input"
                placeholder={placeholder}
                className="field-sizing-content min-h-editor w-full resize-y bg-transparent px-3 py-3 font-mono text-body outline-none placeholder:font-sans placeholder:text-muted-foreground disabled:cursor-not-allowed pointer-coarse:text-large"
              />
            }
          />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel
          value="preview"
          className="flex min-h-editor flex-col gap-3 px-3 py-3 -outline-offset-2 data-hidden:hidden"
        >
          {value.trim() ? (
            <Markdown source={value} headingOffset={1} renderMention={renderMention} />
          ) : (
            <p className="text-body text-muted-foreground">Nothing to preview yet.</p>
          )}
          <p className="mt-auto text-caption text-muted-foreground">
            Only headings, bold, italics, lists, links, code and quotes show. No images, tables or
            HTML. Links open in a new tab.
          </p>
        </TabsPrimitive.Panel>
      </TabsPrimitive.Root>
      <FieldFooter>
        <FieldError>{error}</FieldError>
        <FieldCounter count={length} max={max} />
      </FieldFooter>
    </div>
  )
}
