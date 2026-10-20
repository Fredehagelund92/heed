import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { areasQuery } from '@/api/queries'
import { CopyIcon, DownloadIcon, FileJsonIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { readAnswer, type AnswerView } from '@/lib/assistant'
import { useAskChat } from '@/lib/assistant-chat'
import {
  buildChatExport,
  exportAsJson,
  exportAsMarkdown,
  exportFileName,
  type ExportInput,
} from '@/lib/assistant-export'
import { scopeKeys } from '@/lib/mention-targets'
import { showToast } from '@/lib/toast'
import { statusNames } from '@/lib/library'
import { useLibrary } from '@/lib/use-library'
import { cn } from '@/lib/utils'
import { useVocabularyNames } from '@/components/assistant/ask-composer'
import { scopeWords, useScopeTerms } from '@/components/assistant/ask-scope'
import apiVersion from '@/api/api-version.json' with { type: 'json' }
import pkg from '../../../../package.json' with { type: 'json' }

/*
  Export chat (Assistant board, A): this conversation as text to paste into an email or a chat,
  or as a JSON file for debugging. It holds the questions and the answers, so a line says to read
  it before sharing. What goes in it, and what never does, is lib/assistant-export.ts. It sits
  beside New chat, in the header of the assistant's page and in the panel's bar, and is off while
  the chat is empty.
*/

/**
 * The export of the chat on screen, read when the menu is open and not while an answer arrives,
 * so a long chat is not read again with every word; null while the chat is empty.
 */
function useChatExport(open: boolean): (() => ExportInput) | null {
  const { messages } = useAskChat()
  const library = useLibrary()
  const areas = useQuery(areasQuery()).data ?? noAreas
  const nameOf = useVocabularyNames()
  const read = useMemo(() => {
    if (!open) return null
    const rows = new Map(library.rows.map((row) => [row.id, row]))
    const titleOf = (id: string) => rows.get(id)?.title
    const answers = new Map<string, AnswerView>()
    // The names of every term a question or an answer was about, as the chat shows them.
    const keys = new Set<string>()
    for (const message of messages) {
      for (const key of message.metadata?.scope?.about?.split(',') ?? []) keys.add(key)
      if (message.role !== 'assistant') continue
      const answer = readAnswer(message, { titleOf, areas, nameOf })
      answers.set(message.id, answer)
      if (answer.scopeUsed) for (const key of scopeKeys(answer.scopeUsed.scope)) keys.add(key)
    }
    return { rows, answers, keys: [...keys].sort() }
  }, [open, messages, library.rows, areas, nameOf])
  const terms = useScopeTerms(read?.keys ?? noKeys)
  if (!messages.length) return null
  return () => ({
    messages,
    answers: read?.answers ?? new Map(),
    factRow: (id) => {
      const row = read?.rows.get(id)
      return row ? { status: statusNames[row.displayStatus], domain: row.areaName } : null
    },
    scopeWords: (scope) => scopeWords(scope, terms),
    build: { version: pkg.version, build: apiVersion.api },
    exportedAt: new Date().toISOString(),
    origin: window.location.origin,
  })
}

const noAreas: { id: string; name: string }[] = []
const noKeys: string[] = []

/** Saves text as a file the browser downloads. */
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  // The download has started from the link; the object URL is not needed after that.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Export chat: Copy as text, and Download as JSON, under a line that says what the export has. */
export function ExportChatButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const exported = useChatExport(open)
  const disabled = exported === null
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="toolbar"
                  disabled={disabled}
                  data-slot="ask-export-chat"
                  className={cn('max-md:size-control-touch max-md:px-0', className)}
                />
              }
            />
          }
        >
          <DownloadIcon />
          <span className="max-md:sr-only">Export chat</span>
        </TooltipTrigger>
        <TooltipContent>
          {disabled ? 'This chat is empty' : 'Copy this chat, or save it as a file'}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="whitespace-normal">
            The export has your questions and the answers. Read it before you share it.
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem
          onClick={() => {
            if (!exported) return
            void navigator.clipboard.writeText(exportAsMarkdown(exported())).then(
              () => showToast('Chat copied', 'Read it before you share it.'),
              () => showToast('Couldn’t copy the chat', 'Your browser didn’t allow it.'),
            )
          }}
        >
          <CopyIcon />
          Copy as text
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            if (!exported) return
            const input = exported()
            download(exportFileName(input.exportedAt), exportAsJson(buildChatExport(input)))
            showToast('Chat downloaded', 'Read it before you share it.')
          }}
        >
          <FileJsonIcon />
          Download as JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
