import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent } from 'storybook/test'
import { createQueryClient } from '@/api/query-client'
import { HelpLink } from '@/components/help/help-link'
import { GitCommitHorizontalIcon } from '@/components/icons'
import { ListMessage } from '@/components/library/list-state'
import { RouterFrame } from './router-frame'
import { StoryApp } from './story-app'
import { productName } from '@/lib/brand'

/**
 * Help in context (docs/old-help/README.md): a quiet link in the words of a person's question that
 * opens the few lines of the help page that answer it, and Read the whole page. Beside the
 * words of a screen, after a heading, in an empty state, and with long words that wrap; open,
 * and on a phone as a sheet. Use the viewport menu for 1440, 1024 and 390 and the theme menu
 * for dark.
 */
const meta = {
  title: 'Parts/Help link',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => createQueryClient())
  return (
    <QueryClientProvider client={client}>
      <RouterFrame>
        <div className="flex max-w-reading flex-col gap-6 text-dense">{children}</div>
      </RouterFrame>
    </QueryClientProvider>
  )
}

/** In the sentence it answers, after the screen's own words. */
export const InASentence: Story = {
  render: () => (
    <Frame>
      <p>
        Your AI client asks {productName} before it answers a question about company data.{' '}
        <HelpLink to="mcp">What is an MCP?</HelpLink>
      </p>
    </Frame>
  ),
}

/** After a section's heading, in the caption size. */
export const BesideAHeading: Story = {
  render: () => (
    <Frame>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-body font-bold">What it can do</h2>
        <span className="text-caption">
          <HelpLink to="glossary#tool">What is a tool?</HelpLink>
        </span>
      </div>
    </Frame>
  ),
}

/** An empty state that teaches: what it means in one sentence, and the page that says more. */
export const InAnEmptyState: Story = {
  render: () => (
    <Frame>
      <ListMessage icon={GitCommitHorizontalIcon} title="No editions yet">
        We save an edition each time agents get a change. The first one shows here.{' '}
        <HelpLink to="editions">What is an edition?</HelpLink>
      </ListMessage>
    </Frame>
  ),
}

/** Long words wrap under the glyph's line instead of leaving the column. */
export const LongWords: Story = {
  render: () => (
    <Frame>
      <p className="w-popover text-caption text-muted-foreground">
        Counts below 5 are hidden, so no one can tell who asked.{' '}
        <HelpLink to="common-questions#why-are-some-counts-hidden">
          Why are some counts hidden, and who decides how small a count may be?
        </HelpLink>
      </p>
    </Frame>
  ),
}

/** Open: the page's kind and reading time, the heading it opens at, its words and the page. */
export const Open: Story = {
  render: () => (
    <Frame>
      <p>
        Counts below 5 are hidden, so no one can tell who asked.{' '}
        <HelpLink to="common-questions#why-are-some-counts-hidden">Why?</HelpLink>
      </p>
    </Frame>
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Why?' }))
    await expect(
      await screen.findByRole('heading', { name: 'Why are some counts hidden?' }),
    ).toBeVisible()
    await expect(screen.getByRole('link', { name: 'Read the whole page' })).toHaveAttribute(
      'href',
      '/docs/common-questions#why-are-some-counts-hidden',
    )
  },
}

/** A group of terms with nothing above them opens as each term and its sentence. */
export const OpenAtTerms: Story = {
  render: () => (
    <Frame>
      <p>
        <HelpLink to="glossary#gap">What is a gap?</HelpLink>
      </p>
    </Frame>
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'What is a gap?' }))
    await expect(await screen.findByText(/A topic where people asked/)).toBeVisible()
  },
}

/** On a phone, in the real screen: the help is a sheet with Help in its bar. */
export const PhoneSheet: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <StoryApp path="/settings?section=connect" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'What is an MCP?' }))
    await expect(await screen.findByText(/MCP stands for Model Context Protocol/)).toBeVisible()
  },
}
