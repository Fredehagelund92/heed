import type { SetupStep } from '@/model/inbox'

// The setup checklist of a new install, in the order it can be done. The words are the app's;
// which steps are done is the workspace's (src/web/api).

/** A context item must say which metric it applies to, so its names come before writing. */
export const setupSteps: SetupStep[] = [
  {
    id: 'about',
    title: 'Say what the business is about',
    description: 'Paste a paragraph or write a few lines. Every agent reads it first.',
    action: 'Write',
  },
  {
    id: 'domain',
    title: 'Add your first domain',
    description: 'A part of the business with an owner. Context and names belong to one.',
    action: 'Add a domain',
  },
  {
    id: 'definitions',
    title: 'Connect your definitions',
    description:
      'Connect where your metrics are defined, then publish their names. Context applies to those names.',
    action: 'Connect',
  },
  {
    id: 'fact',
    title: 'Write your first context item',
    description: 'Two sentences and a source. In a domain you own, it goes live at once.',
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
]
