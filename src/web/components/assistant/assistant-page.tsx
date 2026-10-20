import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Page, PageContent, PageStickyBar } from '@/components/page/page'
import { readAnswer, type AnswerView } from '@/lib/assistant'
import { sharedScope, useAskChat } from '@/lib/assistant-chat'
import type { AssistantSearch } from '@/lib/search-params'
import { scopeFromSearch, searchOf, type TryItScope } from '@/lib/try-it'
import { useLibrary } from '@/lib/use-library'
import { FactsRead } from './ask-answer'
import { AskComposer } from './ask-composer'
import { ScopeChips } from './ask-scope'
import { agentHrefOf, AskTranscript } from './ask-view'
import { DockButton } from '@/components/app-shell/dock-button'
import { HeaderActions } from '@/components/app-shell/header-actions'
import { NewChatButton, NewChatConfirm } from '@/components/app-shell/new-chat'

/*
  The assistant as a page (Assistant board, A.full): the same conversation as the panel, with
  room. It is the assistant expanded, one of its three states (contract 9.8): the sidebar's
  Assistant and G then A open it, and Dock, in the header, docks it beside the page the person
  came from; New chat, beside it, starts the conversation afresh. The scope is in the address, in the same params as What an agent would get's page,
  so a link and Back keep it; an address without one takes the scope the panel had, so expanding
  keeps it. The conversation is never in the address. From 1,152 wide a side column shows what
  the latest answer is about and the facts it read (editions show only on the Editions page).
*/

function InThisAnswer({ answer, scope }: { answer: AnswerView | null; scope: TryItScope | null }) {
  const library = useLibrary()
  const lookup = (id: string) => library.rows.find((row) => row.id === id) ?? null
  return (
    <aside
      aria-labelledby="in-this-answer"
      data-slot="ask-in-this-answer"
      className="hidden w-companion shrink-0 flex-col gap-6 overflow-y-auto border-l px-6 py-6 @6xl:flex"
    >
      <h2 id="in-this-answer" className="text-large font-bold">
        In this answer
      </h2>
      {!answer ? (
        <p className="text-dense text-muted-foreground">
          Ask a question. What it’s about and each fact I read show here.
        </p>
      ) : (
        <>
          {scope ? (
            <section aria-label="About" className="flex flex-col gap-2">
              <h3 className="text-caption font-bold">About</h3>
              <ScopeChips scope={scope} label="What the answer is about" />
            </section>
          ) : null}
          <FactsRead answer={answer} lookup={lookup} />
          {/* A greeting or thanks reads nothing: say so, never an empty column. */}
          {!scope && !answer.facts.length ? (
            <p className="text-dense text-muted-foreground">This answer didn’t need any facts.</p>
          ) : null}
        </>
      )}
    </aside>
  )
}

export function AssistantPage({ search }: { search: AssistantSearch }) {
  const navigate = useNavigate()
  const scope = scopeFromSearch(search)
  const { messages } = useAskChat()
  const setScope = (next: TryItScope | null) => {
    // Cleared here, the scope is cleared for the panel too, so the address stays without one.
    if (!next) sharedScope.set(null)
    void navigate({
      to: '/assistant',
      search: next ? searchOf(next) : {},
      replace: true,
      resetScroll: false,
    })
  }
  // The panel shares the page's scope, so docking keeps it; an address without a scope takes the
  // panel's, so expanding keeps it too.
  useEffect(() => {
    const shared = sharedScope.get()
    if (!scope && shared) setScope(shared)
    else sharedScope.set(scope)
    // The address is the scope: once per change of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.about, search.from, search.to])
  const openAgent = (asked: TryItScope | null) =>
    void navigate({ to: '/try-it', search: asked ? searchOf(asked) : {} })
  const latest = messages.findLast((message) => message.role === 'assistant')
  const answer = latest ? readAnswer(latest) : null
  return (
    <Page title="Assistant">
      <HeaderActions phone>
        <NewChatButton />
      </HeaderActions>
      <NewChatConfirm />
      <DockButton />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <PageContent width="reading" className="pb-8">
            <AskTranscript
              scope={scope}
              onScopeChange={setScope}
              onOpenAgent={openAgent}
              agentHref={agentHrefOf}
              factsClassName="@6xl:hidden"
            />
          </PageContent>
          <PageStickyBar>
            <AskComposer scope={scope} onScopeChange={setScope} className="max-w-reading" />
          </PageStickyBar>
        </div>
        <InThisAnswer answer={answer} scope={answer?.scopeUsed ?? scope} />
      </div>
    </Page>
  )
}
