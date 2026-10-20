import { Link } from '@tanstack/react-router'
import { AskComposer } from '@/components/assistant/ask-composer'
import { NewChatButton, NewChatConfirm } from './new-chat'
import { agentHrefOf, AskTranscript } from '@/components/assistant/ask-view'
import { DockPanel, useDockMode, type DockTab } from '@/components/page/dock-panel'
import { TryItView } from '@/components/try-it/try-it-view'
import { TabsContent } from '@/components/ui/tabs'
import { useSharedScope } from '@/lib/assistant-chat'
import { searchOf } from '@/lib/try-it'
import type { AssistantTab } from './shell-actions'

const tabs: readonly DockTab<AssistantTab>[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'agent', label: 'Try a question' },
]

/**
 * The assistant's panel, docked from the launcher in the bottom-right corner (Quality design,
 * section 0) or with Command or Control backslash: it opens on the right, beside the page you are
 * on, and stays open as you move between pages. It is never shown with the assistant's own pages
 * (contract 9.8). Ask is the assistant's chat (Assistant board, direction A), with its composer
 * pinned at the bottom and New chat in its bar. Try a question is Try it: a scope in, the facts
 * and instructions an AI app gets out, with no model. The two share one scope (C's shared scope
 * bar), so an answer and what an AI app gets are about the same thing; using these facts in your
 * own AI app is a setting of your own (Settings, Connect an AI app). Each tab expands to its own page, with the
 * scope; Ask keeps its conversation there.
 */
export function AssistantPanel({
  tab,
  onTabChange,
  onClose,
  onLeave,
  leaving = false,
}: {
  tab: AssistantTab
  onTabChange: (tab: AssistantTab) => void
  /** Closed from the panel: focus goes back to what opened it. */
  onClose: () => void
  /** Closed by going to another page from it, which then has the screen. */
  onLeave: () => void
  /** Closed, and on screen only for its exit (DockPanel). */
  leaving?: boolean
}) {
  const [scope, setScope] = useSharedScope()
  // Docked or over the page, the panel stays open beside a page opened from it; on a phone,
  // where it fills the screen, that page takes the screen.
  const phone = useDockMode() === 'full'
  const leave = phone ? onLeave : undefined
  const search = scope ? searchOf(scope) : {}
  const expand =
    tab === 'ask' ? (
      <Link to="/assistant" search={search} onClick={onLeave} />
    ) : (
      <Link to="/try-it" search={search} onClick={onLeave} />
    )
  return (
    <DockPanel
      title="Assistant"
      tabs={tabs}
      tab={tab}
      onTabChange={onTabChange}
      tabsLabel="Assistant"
      browse={false}
      expand={expand}
      controls={tab === 'ask' ? <NewChatButton /> : undefined}
      focusOnOpen
      leaving={leaving}
      onClose={onClose}
      footer={tab === 'ask' ? <AskComposer scope={scope} onScopeChange={setScope} /> : undefined}
    >
      <TabsContent value="ask" className="flex flex-col gap-4">
        <AskTranscript
          scope={scope}
          onScopeChange={setScope}
          onOpenAgent={(asked) => {
            if (asked) setScope(asked)
            onTabChange('agent')
          }}
          agentHref={agentHrefOf}
          onLeave={leave}
        />
      </TabsContent>
      <TabsContent value="agent" className="flex flex-col gap-4">
        <TryItView asked={scope} onAsk={setScope} onLeave={leave} idPrefix="assistant-try-it" />
      </TabsContent>
      <NewChatConfirm />
    </DockPanel>
  )
}
