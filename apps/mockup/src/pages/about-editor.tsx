import * as React from "react"
import { useEditor } from "@tiptap/react"
import { CheckIcon, CircleAlertIcon, Loader2Icon, PanelRightIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { RichTextEditor } from "@/components/editor"
import { Button } from "@/components/ui/button"
import { ABOUT_BUSINESS } from "@/data/world"
import { DocumentEditorShell } from "@/components/heed/document-shell"
import { DocFooter, Paper } from "@/components/heed/doc"
import { HeaderMore } from "@/components/heed/editor-header"
import { Panel } from "@/components/heed/panel"
import { ResizableAside } from "@/components/resizable-aside"
import { SiteHeader } from "@/components/site-header"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { useHelpAside } from "@/lib/help-aside"
import { useWide } from "@/hooks/use-wide"
import { docExtensions } from "@/lib/doc-extensions"
import { navigate, useRoute } from "@/lib/router"
import { useMe, useStore } from "@/lib/store"

// About our business in the same document editor shell as a context item: the formatting row under
// the header, the text on the document sheet, markdown in and out, one footer with the count. It
// saves itself, so a quiet status replaces a Save button. The help panel is closed until asked for.
// Loaded on its own, like the other editors, to keep Tiptap out of the first load.

const LIMIT = 1200

export function AboutPage({ title, helpText }: { title: React.ReactNode; helpText: React.ReactNode }) {
  const me = useMe()
  const { state, dispatch } = useStore()
  const { query } = useRoute()
  const setup = query.get("setup")
  // Null until the first keystroke; until then the count is what the editor writes back.
  const [typed, setLength] = React.useState<number | null>(null)
  const [saving, setSaving] = React.useState(false)
  const timer = React.useRef<number>(0)

  const waiting = React.useRef<string | null>(null)
  const save = (text: string) => {
    setLength(text.length)
    window.clearTimeout(timer.current)
    if (text.length > LIMIT) {
      waiting.current = null
      return setSaving(false)
    }
    waiting.current = text
    setSaving(true)
    timer.current = window.setTimeout(() => {
      dispatch({ type: "about", text })
      waiting.current = null
      setSaving(false)
    }, 700)
  }
  // Leaving the page saves what is still waiting, so a quick change is never lost.
  React.useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (waiting.current !== null) dispatch({ type: "about", text: waiting.current })
    },
    [dispatch]
  )

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: docExtensions("We are a … We sell …"),
    content: state.about,
    contentType: "markdown",
    editorProps: { attributes: { "aria-label": "About our business" } },
    onUpdate: ({ editor }) => save(editor.getMarkdown()),
  })
  // Count what the editor writes back, so the number never jumps on the first keystroke.
  const written = React.useMemo(() => editor?.getMarkdown().length ?? state.about.length, [editor, state.about])
  const length = typed ?? written
  const tooLong = length > LIMIT

  const help = useHelpAside(me.name)
  const [paneRef, wide] = useWide<HTMLDivElement>()

  const status = (
    <span className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", tooLong && "text-destructive")} aria-live="polite">
      {tooLong ? (
        <CircleAlertIcon className="size-3.5" aria-hidden />
      ) : saving ? (
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <CheckIcon className="size-3.5" aria-hidden />
      )}
      <span className={cn(!tooLong && "max-sm:sr-only")}>{tooLong ? "Not saved" : saving ? "Saving" : "Saved"}</span>
    </span>
  )

  return (
    <DocumentEditorShell
      editor={editor}
      paneRef={paneRef}
      header={
        <SiteHeader title={title} bare>
          {status}
          {setup && (
            <Button
              size="sm"
              data-primary
              disabled={tooLong || length === 0}
              onClick={() => {
                window.clearTimeout(timer.current)
                dispatch({ type: "about", text: editor.getMarkdown() })
                dispatch({ type: "setupStep", step: "about" })
                toast("Saved", { description: "Agents read it from the next question." })
                navigate("/inbox")
              }}
            >
              Done
            </Button>
          )}
          <HeaderMore>
            <DropdownMenuItem onClick={() => help.setOpen(!help.open)}>
              <PanelRightIcon />
              {help.open ? "Hide what to put here" : "Show what to put here"}
            </DropdownMenuItem>
          </HeaderMore>
        </SiteHeader>
      }
      aside={
        help.open &&
        wide && (
          <ResizableAside side="right" storageKey="settings-help" defaultWidth={320} min={260} max={440} label="What to put here" className="border-l bg-background">
            <Panel title="What to put here" onClose={() => help.setOpen(false)} closeLabel="Hide what to put here">
              <div className="p-4 text-sm text-muted-foreground md:px-5 [&_li]:mt-2 [&_li:first-child]:mt-0 [&_ul]:ml-4 [&_ul]:list-disc">{helpText}</div>
            </Panel>
          </ResizableAside>
        )
      }
      footer={
        <DocFooter>
          <span className={cn("tabular-nums", tooLong && "font-medium text-destructive")}>
            {length.toLocaleString("en-GB")} of {LIMIT.toLocaleString("en-GB")}
            <span className={cn(!tooLong && "max-sm:sr-only")}> characters{tooLong && ". Shorten it to save"}</span>
          </span>
          <span className="hidden sm:inline">Markdown</span>
        </DocFooter>
      }
    >
      <Paper>
        <h2 className="text-2xl leading-tight font-bold tracking-tight sm:text-3xl">About our business</h2>
        <p className="mt-2 mb-6 border-b pb-5 text-sm text-muted-foreground sm:mb-8">The one text every agent reads first, before any context.</p>
        <RichTextEditor.Content className="text-base [&_.ProseMirror]:min-h-64! [&_.ProseMirror]:max-w-reading [&_.ProseMirror]:p-0!" />
        {length === 0 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              editor.commands.setContent(ABOUT_BUSINESS, { contentType: "markdown" })
              save(editor.getMarkdown())
            }}
          >
            Start from the guide
          </Button>
        )}
      </Paper>
      {help.open && !wide && (
        <div className="border-t bg-background p-4 text-sm text-muted-foreground [&_li]:mt-2 [&_li:first-child]:mt-0 [&_ul]:ml-4 [&_ul]:list-disc">
          <p className="mb-2 font-medium text-foreground">What to put here</p>
          {helpText}
        </div>
      )}
    </DocumentEditorShell>
  )
}
