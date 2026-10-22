import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'
import { createQueryClient } from '@/api/query-client'
import { createAppRouter } from '@/router'
import { StoryApp } from './story-app'

/** The whole empty shell with the real route tree, on an in-memory history. */
function ShellAt({ path }: { path: string }) {
  const [{ queryClient, router }] = useState(() => {
    const client = createQueryClient()
    const appRouter = createAppRouter(client, createMemoryHistory({ initialEntries: [path] }))
    return { queryClient: client, router: appRouter }
  })
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Shell/App shell',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Home: Story = { render: () => <ShellAt path="/" /> }
export const ContextLibrary: Story = { render: () => <ShellAt path="/library?kind=event" /> }
/** An item page: Add a fact in the header is the same ink button as on the library. */
export const ItemPage: Story = { render: () => <ShellAt path="/library/itm_jyfuvl07" /> }
export const DesignPreviewList: Story = { render: () => <ShellAt path="/design-preview/list" /> }

/*
  The menus by role (Quality design, section 0; navigation decision, 12 October 2026), on the
  mock with its people: Maria Lindqvist is a contributor, Jon Abara an owner, Ella Voss an
  auditor, Ravi Kapoor an administrator. No one has a Settings row: a person's own Settings open
  from the user menu.
*/

/**
 * A contributor: the main places, with the Assistant after Home, and Gaps. The Assistant opens it
 * full screen; the launcher docks it beside the page.
 */
export const ContributorMenu: Story = {
  render: () => <StoryApp path="/library" person="per_maria" />,
  play: async () => {
    const sidebar = await screen.findByRole('navigation', { name: 'Main navigation' })
    await expect(await within(sidebar).findByRole('link', { name: 'Gaps' })).toBeVisible()
    await expect(within(sidebar).getByRole('link', { name: 'Assistant' })).toBeVisible()
    await expect(within(sidebar).queryByText('Ask')).toBeNull()
    await expect(within(sidebar).queryByRole('link', { name: 'Health' })).toBeNull()
    await expect(within(sidebar).queryByRole('link', { name: 'Administration' })).toBeNull()
    await expect(within(sidebar).queryByRole('link', { name: 'Settings' })).toBeNull()
  },
}

/** An owner has Editions, and Health in place of Gaps, in the lower group behind a divider. */
export const OwnerMenu: Story = {
  render: () => <StoryApp path="/health" person="per_jon" />,
  play: async () => {
    const sidebar = await screen.findByRole('navigation', { name: 'Main navigation' })
    await expect(await within(sidebar).findByRole('link', { name: 'Health' })).toBeVisible()
    await expect(within(sidebar).getByRole('link', { name: 'Editions' })).toBeVisible()
    await expect(within(sidebar).queryByRole('link', { name: 'Gaps' })).toBeNull()
    await expect(within(sidebar).queryByRole('link', { name: 'Administration' })).toBeNull()
    await expect(sidebar.querySelector('[data-slot="sidebar-separator"]')).not.toBeNull()
  },
}

/** An auditor has Gaps, and Administration for the history log. */
export const AuditorMenu: Story = {
  render: () => <StoryApp path="/admin" person="per_ella" />,
  play: async () => {
    const sidebar = await screen.findByRole('navigation', { name: 'Main navigation' })
    await expect(await within(sidebar).findByRole('link', { name: 'Administration' })).toBeVisible()
    await expect(within(sidebar).getByRole('link', { name: 'Gaps' })).toBeVisible()
    await expect(within(sidebar).queryByRole('link', { name: 'Editions' })).toBeNull()
  },
}

/** An administrator also has Administration, last in the lower group with Editions and Health. */
export const AdministratorMenu: Story = {
  render: () => <StoryApp path="/editions" person="per_ravi" />,
  play: async () => {
    const sidebar = await screen.findByRole('navigation', { name: 'Main navigation' })
    await expect(await within(sidebar).findByRole('link', { name: 'Administration' })).toBeVisible()
    for (const name of ['Editions', 'Health'])
      await expect(within(sidebar).getByRole('link', { name })).toBeVisible()
    await expect(within(sidebar).queryByText('Admin')).toBeNull()
    await expect(within(sidebar).queryByText('Improve')).toBeNull()
    await expect(sidebar.querySelector('[data-slot="sidebar-separator"]')).not.toBeNull()
  },
}

/** The user menu holds the person's own Settings: Profile and appearance, and Connect an agent. */
export const UserMenu: Story = {
  render: () => <StoryApp path="/library" person="per_maria" />,
  play: async () => {
    const sidebar = await screen.findByRole('navigation', { name: 'Main navigation' })
    await userEvent.click(await within(sidebar).findByRole('button', { name: /Maria Lindqvist/ }))
    await expect(
      await screen.findByRole('menuitem', { name: /Profile and appearance/ }),
    ).toBeVisible()
    await expect(screen.getByRole('menuitem', { name: /Connect an agent/ })).toBeVisible()
  },
}

/** The sidebar as a 48 pixel rail at 1024: the user's avatar sits centred under the icons. */
export const LaptopRail: Story = {
  render: () => <StoryApp path="/library" person="per_jon" />,
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async () => {
    const button = await screen.findByRole('button', { name: /^JA Jon Abara/ })
    // Centred and whole: 2 pixels of the 32 pixel button on each side of the 28 pixel avatar.
    await waitFor(() => {
      const outer = button.getBoundingClientRect()
      const inner = button.querySelector('[data-slot="avatar"]')?.getBoundingClientRect()
      const sides = inner ? [outer.width, inner.left - outer.left, outer.right - inner.right] : []
      if (sides.join() !== '32,2,2') throw new Error(`The rail's user button is ${sides.join()}`)
    })
  },
}

/** Try it as a page: What an agent would get, before anything is asked. */
export const TryIt: Story = { render: () => <StoryApp path="/try-it" /> }

/** The launcher in the bottom-right corner, over the library's totals. */
export const Launcher: Story = {
  render: () => <StoryApp path="/library" />,
  play: async () => {
    const launcher = await screen.findByRole('button', { name: 'Assistant' })
    await expect(launcher).toHaveAttribute('aria-expanded', 'false')
  },
}

/** The assistant open beside the page, from the launcher: Ask is coming soon, said plainly. */
export const AssistantOpen: Story = {
  render: () => <StoryApp path="/library" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Assistant' }))
    const panel = await screen.findByRole('region', { name: 'Assistant' })
    await expect(panel).toBeVisible()
    await expect(within(panel).getByRole('tab', { name: 'Ask' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
}

/**
 * The assistant expanded, from the sidebar's Assistant or G then A: no panel and no launcher
 * beside it (one assistant, contract 9.8), and Dock in the header.
 */
export const AssistantExpanded: Story = {
  render: () => <StoryApp path="/assistant" />,
  play: async () => {
    const sidebar = await screen.findByRole('navigation', { name: 'Main navigation' })
    await expect(within(sidebar).getByRole('link', { name: 'Assistant' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(await screen.findByRole('button', { name: 'Dock' })).toBeVisible()
    await expect(screen.queryByRole('button', { name: 'Assistant' })).toBeNull()
    await expect(screen.queryByRole('region', { name: 'Assistant' })).toBeNull()
  },
}

/** Dock, from the assistant's page: the same conversation beside the page, Home here. */
export const AssistantDockedFromPage: Story = {
  render: () => <StoryApp path="/assistant" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Dock' }))
    const panel = await screen.findByRole('region', { name: 'Assistant' })
    await expect(within(panel).getByRole('tab', { name: 'Ask' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(screen.queryByRole('button', { name: 'Dock' })).toBeNull()
  },
}

/** The assistant expanded on a phone: Dock stays in the header as an icon. */
export const AssistantExpandedPhone: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: AssistantExpanded.render,
  play: async () => {
    await expect(await screen.findByRole('button', { name: 'Dock' })).toBeVisible()
    await expect(screen.queryByRole('button', { name: 'Assistant' })).toBeNull()
  },
}

/** What an agent would get: Try it, in the assistant's second tab. */
export const AssistantAgentTab: Story = {
  render: () => <StoryApp path="/library" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Assistant' }))
    const panel = await screen.findByRole('region', { name: 'Assistant' })
    await userEvent.click(within(panel).getByRole('tab', { name: 'What an agent would get' }))
    await waitFor(() => expect(within(panel).getByText('See what an agent gets')).toBeVisible())
  },
}

/** The assistant over a record's panel: one panel at a time, the record waits underneath. */
export const AssistantOverRecord: Story = {
  render: () => <StoryApp path="/library?panel=itm_jyfuvl07" />,
  play: async () => {
    await screen.findByRole('region', { name: /Comparing Units per order/ })
    await userEvent.click(await screen.findByRole('button', { name: 'Assistant' }))
    await expect(await screen.findByRole('region', { name: 'Assistant' })).toBeVisible()
    await expect(screen.queryByRole('region', { name: /Comparing Units per order/ })).toBeNull()
  },
}

/** The launcher on a phone, above the home indicator. */
export const LauncherPhone: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: Launcher.render,
  play: Launcher.play,
}

/** The assistant on a phone fills the screen, with a back arrow; the launcher makes way. */
export const AssistantPhone: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: AssistantOpen.render,
  play: AssistantOpen.play,
}
