import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent } from 'storybook/test'
import { StoryApp } from './story-app'

/**
 * The Docs area (docs/old-help) in docs mode: the app's sidebar folded to its rail and the docs' own
 * sidebar beside it (a drawer below 1024 wide), the docs home and its search, a section, and a
 * page of each template, a concept with its answer in one minute and its pictures, a guide with
 * its steps and the glossary, in the real shell. Use the viewport menu for 1440, 1024 and 390
 * and the theme menu for dark.
 */
const meta = {
  title: 'Pages/Docs',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** The docs home in docs mode: the reading path, the loop and its steps, the docs' tree beside. */
export const Home: Story = {
  render: () => <StoryApp path="/docs" />,
  play: async () => {
    await expect(
      await screen.findByRole('heading', { name: 'Start here, in this order' }),
    ).toBeVisible()
    await expect(screen.getByRole('tree', { name: 'Docs pages' })).toBeVisible()
  },
}

/** One section on its own address (a page's crumb): what it holds, then its pages as rows. */
export const Section: Story = {
  render: () => <StoryApp path="/docs?section=guides" />,
  play: async () => {
    await expect(await screen.findByRole('region', { name: 'Guides' })).toBeVisible()
    await expect(screen.queryByRole('heading', { name: 'Start here, in this order' })).toBeNull()
  },
}

/** Searching the docs from their sidebar: the pages that match replace the tree. */
export const Search: Story = {
  render: () => <StoryApp path="/docs" />,
  play: async () => {
    const field = await screen.findByRole('searchbox', { name: 'Search the docs' })
    await userEvent.type(field, 'stop switch')
    await expect(await screen.findByRole('region', { name: 'Search results' })).toHaveTextContent(
      'Editions and the stop switch',
    )
  },
}

/** The docs' tree from the keyboard: Left closes the open page's section, Right opens it again. */
export const TreeKeys: Story = {
  render: () => <StoryApp path="/docs/editions" />,
  play: async () => {
    const page = await screen.findByRole('treeitem', { name: 'Editions and the stop switch' })
    page.focus()
    await userEvent.keyboard('{ArrowLeft}')
    const section = screen.getByRole('treeitem', { name: 'Concepts' })
    await expect(section).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(section).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('{ArrowRight}')
    await expect(section).toHaveAttribute('aria-expanded', 'true')
  },
}

/** A concept: its answer in one minute, two pictures, On this page and Related in the rail. */
export const Concept: Story = {
  render: () => <StoryApp path="/docs/mcp" />,
  play: async () => {
    await expect(await screen.findByRole('region', { name: 'In one minute' })).toBeVisible()
    await expect(screen.getByRole('img', { name: /^The plug: agents/ })).toBeVisible()
  },
}

/** A guide: before you start, numbered steps in the app's own words, and what can go wrong. */
export const Guide: Story = {
  render: () => <StoryApp path="/docs/add-your-first-context" />,
  play: async () => {
    await expect(await screen.findByRole('heading', { name: 'Steps', level: 2 })).toBeVisible()
  },
}

/** The glossary: a term under each heading, grouped by theme. */
export const Glossary: Story = {
  render: () => <StoryApp path="/docs/glossary" />,
  play: async () => {
    await expect(await screen.findByRole('heading', { name: 'Edition', level: 3 })).toBeVisible()
  },
}

/** A concept on a phone: one column, the Pages bar, On this page folded under the title. */
export const PhoneConcept: Story = {
  render: () => <StoryApp path="/docs/what-is-heed" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async () => {
    await expect(await screen.findByRole('region', { name: 'In one minute' })).toBeVisible()
  },
}

/** The docs' drawer on a phone: Docs, Back, the search field and the tree. */
export const PhonePages: Story = {
  render: () => <StoryApp path="/docs/mcp" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Pages' }))
    const drawer = await screen.findByRole('dialog', { name: 'Docs' })
    await expect(drawer).toBeVisible()
    await expect(screen.getByRole('link', { name: 'Back' })).toBeVisible()
  },
}
