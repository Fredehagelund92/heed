import type { ReactNode } from 'react'
import { Logo } from '@/components/app-shell/logo'
import { Page, PageContent } from '@/components/page/page'

/**
 * The frame of the pages that stand outside the shell because nothing on them needs a session:
 * the sign-in page and the agent consent screen. One card on the quiet sidebar surface, centred
 * across at every width and at the top of the page, so the sign-in's list of people opens below
 * its field with room for about ten people. The 32 pixel lockup sits 24 above the heading
 * (docs/design/logo.md).
 */
export function AuthPage({
  title,
  heading,
  children,
}: {
  title: string
  /** `paper` when the card's own heading is the page's `h1`. */
  heading?: 'hidden' | 'paper'
  children: ReactNode
}) {
  return (
    <main id="main" className="flex min-h-svh flex-col bg-sidebar">
      <Page title={title} heading={heading}>
        <PageContent className="items-center">
          <div
            data-slot="auth-card"
            className="flex w-full max-w-md flex-col gap-6 rounded-lg border bg-card p-8 text-card-foreground @max-md:p-6"
          >
            <Logo className="h-8 self-start" />
            {children}
          </div>
        </PageContent>
      </Page>
    </main>
  )
}
