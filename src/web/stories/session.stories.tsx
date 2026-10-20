import type { Meta, StoryObj } from '@storybook/react-vite'
import { StoryApp } from './story-app'

/**
 * The session in the shell: the user menu names the signed-in person's roles, from the session
 * the service returns, and a visit without a session lands on the signed-out page. Open the user
 * menu at the bottom of the sidebar to see every role on its own line.
 */
const meta = {
  title: 'Shell/Session',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Everyone signed in writes context: Maria has no other role. */
export const Contributor: Story = { render: () => <StoryApp path="/" /> }

/** Jon looks after two areas: "Owner of Sales and Sandbox". */
export const Owner: Story = { render: () => <StoryApp path="/" person="per_jon" /> }

export const Deputy: Story = { render: () => <StoryApp path="/" person="per_sofia" /> }

/** Lars adds the second accept to a high-risk proposal in Sales. */
export const HighRiskApprover: Story = {
  render: () => <StoryApp path="/" person="per_lars" />,
}

/** Only an administrator sees the Admin group in the sidebar. */
export const Administrator: Story = { render: () => <StoryApp path="/" person="per_ravi" /> }

/** Any 401 opens this page instead of an empty list; Continue goes back to the library. */
export const SignedOut: Story = {
  render: () => <StoryApp path="/library" scenario="signed-out" />,
}
