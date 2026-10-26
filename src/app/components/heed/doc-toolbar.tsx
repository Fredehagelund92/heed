import { useEditorState, type Editor } from '@tiptap/react'
import { ChevronDownIcon, MinusIcon, PlusIcon, QuoteIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { RichTextEditor } from '@/components/editor'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// The toolbar of the one document editor Heed writes long text in, a flat strip under a hairline.
// The context editor, the term editor and About our business share it (and docExtensions).

/* ---------- editorcn's toolbar, trimmed to what markdown carries ---------- */

// The template's scroll shadows on the toolbar pill, so a phone shows there is more to the side.
const SCROLL_SHADOWS = {
  background: [
    'linear-gradient(to right, var(--toolbar-bg, var(--background)) 30%, transparent) left / 2.5rem 100% no-repeat local',
    'linear-gradient(to left, var(--toolbar-bg, var(--background)) 30%, transparent) right / 2.5rem 100% no-repeat local',
    'radial-gradient(farthest-side at 0 50%, rgb(0 0 0 / 0.14), transparent) left / 0.75rem 100% no-repeat scroll',
    'radial-gradient(farthest-side at 100% 50%, rgb(0 0 0 / 0.14), transparent) right / 0.75rem 100% no-repeat scroll',
    'var(--toolbar-bg, var(--background))',
  ].join(', '),
}

const ACTIVE_ITEM = "rounded-md py-1 pl-2 text-dense [&_svg:not([class*='size-'])]:size-3.5"

const TEXT_STYLES = [
  { label: 'Paragraph', value: '0', className: '' },
  { label: 'Heading 2', value: '2', className: 'font-semibold' },
  { label: 'Heading 3', value: '3', className: 'font-medium' },
]

function TextStyleMenu({ editor }: { editor: Editor | null }) {
  const value =
    useEditorState({
      editor,
      selector: ({ editor: e }) =>
        e ? String([2, 3].find((l) => e.isActive('heading', { level: l })) ?? 0) : '0',
    }) ?? '0'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="h-8 w-26 justify-between px-2 text-dense" />
        }
      >
        {TEXT_STYLES.find((s) => s.value === value)?.label}
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32 p-1">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const level = Number(next) as 0 | 2 | 3
            const chain = editor?.chain().focus()
            ;(level ? chain?.setHeading({ level }) : chain?.setParagraph())?.run()
          }}
        >
          {TEXT_STYLES.map((s) => (
            <DropdownMenuRadioItem
              key={s.value}
              value={s.value}
              className={cn(ACTIVE_ITEM, s.className)}
            >
              {s.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function InsertMenu({ editor }: { editor: Editor | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-dense" />}
      >
        <PlusIcon className="size-4" />
        Insert
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36 p-1">
        <DropdownMenuItem
          className="rounded-md py-1 text-dense [&_svg]:size-3.5!"
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <QuoteIcon />
          Quote
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-md py-1 text-dense [&_svg]:size-3.5!"
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        >
          <MinusIcon />
          Divider
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Toolbar({ editor, className }: { editor: Editor | null; className?: string }) {
  return (
    <div className={cn('flex h-tool shrink-0 items-center border-b bg-background', className)}>
      <div
        className="w-full max-w-full scrollbar-none overflow-x-auto px-2 md:px-4 [&::-webkit-scrollbar]:hidden"
        style={SCROLL_SHADOWS}
      >
        <RichTextEditor.Toolbar className="flex-nowrap! justify-start! border-0! bg-transparent! px-1! py-1! sm:w-max [&_.rte-controls-group>button:not([data-state=on]):not([aria-pressed=true])]:text-foreground! [&>*]:shrink-0">
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Undo />
            <RichTextEditor.Redo />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <TextStyleMenu editor={editor} />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Bold />
            <RichTextEditor.Italic />
            <RichTextEditor.Code />
            <RichTextEditor.Link />
            <RichTextEditor.ClearFormatting />
          </RichTextEditor.ControlsGroup>
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.BulletList />
            <RichTextEditor.OrderedList />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <InsertMenu editor={editor} />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
      </div>
    </div>
  )
}
