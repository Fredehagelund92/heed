import type { SetupStep } from '@/model/inbox'

// The setup checklist of a new install: write first, connect later. The words are the app's; which
// steps are done is the workspace's (src/app/api).

/** Write first, connect later: value in about ten actions, connectors when they help. */
export const setupSteps: SetupStep[] = [
  {
    id: 'about',
    title: 'Say what the business is about',
    description: 'Paste a paragraph or write a few lines. Every agent reads it first.',
    action: 'Write',
  },
  {
    id: 'fact',
    title: 'Write your first context item',
    description: 'Two sentences and a source. You own the domain Company, so it goes live at once.',
    action: 'Write context',
  },
  {
    id: 'ask',
    title: 'Ask a question about it',
    description: 'See the answer an agent gets, from what you just wrote.',
    action: 'Ask',
  },
  {
    id: 'agent',
    title: 'Connect your agent',
    description: 'Paste one prompt into Claude, Cursor or another agent, and approve it once.',
    action: 'Copy the prompt',
  },
  {
    id: 'definitions',
    title: 'Connect your definitions',
    description:
      'Connect where your metrics are defined, so their names arrive by themselves. It can wait.',
    action: 'Connect',
  },
]
