import type { Meta, StoryObj } from '@storybook/react-vite'
import { PageTemplatePreview } from '@/design-preview/templates'
import { TokensPreview } from '@/design-preview/tokens'

/**
 * The page templates and the tokens, without the shell. Use the viewport and theme menus to
 * see the 1440, 1024 and 390 wide layouts in light and dark.
 */
const meta = {
  title: 'Page templates',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const List: Story = { render: () => <PageTemplatePreview template="list" /> }
export const Document: Story = { render: () => <PageTemplatePreview template="document" /> }
export const Overview: Story = { render: () => <PageTemplatePreview template="overview" /> }
export const Empty: Story = { render: () => <PageTemplatePreview template="empty" /> }
export const Tokens: Story = { render: () => <TokensPreview /> }
