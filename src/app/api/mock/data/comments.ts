import type { CommentItem, CommentReaction } from '@/components/templates/comment-box/types'
import { text } from '@/components/templates/comment-box/utils'
import type { NewReply, Subject } from '@/model/comments'

// Comments in the demo world, keyed by what they hang on: a suggestion in the review
// ("review:<id>") or a context item ("context:<id>"). They are kept apart from the context on
// purpose: nothing an agent reads is built from them (see lib/agent-reply.ts and its test).

/** The proposer withdrawing the retirement: the review shows this outcome instead of Archive. */
export const LARS_REPLY =
  "You're right: card payments for 1 to 18 January are still missing. I'll suggest new dates instead of archiving it."

/** Reactions on the suggestion or the context item itself, apart from its comments. */
export const seedReactions: Partial<Record<Subject, CommentReaction[]>> = {
  'review:sug-sofia-clash': [{ emoji: '👀', by: ['Tomas Eriksen'] }],
  'context:itm_norway_stop': [
    { emoji: '👍', by: ['Maria Lindqvist', 'Tomas Eriksen', 'Ines Duarte'] },
    { emoji: '🙏', by: ['Kofi Mensah'] },
  ],
}

export const seedComments: Partial<Record<Subject, CommentItem[]>> = {
  // A return with a note, and the suggester's answer: the card is back in the owner's Inbox.
  'review:sug-lars-retire': [
    {
      id: 'c_lars_1',
      author: 'Jon Abara',
      when: 'Yesterday, 14:20',
      returned: true,
      content: text(
        'Finance restated the bank transfers, but card payments before 19 January are still missing from the new report. Archiving it would tell agents that January is complete. Can you check with Finance which days are still short?',
      ),
      replies: [
        {
          id: 'c_lars_2',
          author: 'Lars Dahl',
          when: 'Today, 08:50',
          content: text(LARS_REPLY),
        },
      ],
    },
  ],
  // An agent's suggestion: the person who said yes to it answers, never the agent.
  'review:sug-agent': [
    {
      id: 'c_agent_1',
      author: 'Jon Abara',
      when: 'Yesterday, 17:05',
      content: text(
        'The source says Polish **card payments**, and the suggestion says all Poland orders. Do bank transfers and BLIK arrive late too, or only cards?',
      ),
      replies: [
        {
          id: 'c_agent_2',
          author: 'Kofi Mensah',
          when: 'Today, 08:12',
          content: text(
            'Only cards. Transfers and BLIK come in the next morning as before. The agent wrote orders; it should say card orders.',
          ),
          reactions: [{ emoji: '🙏', by: ['Jon Abara'] }],
        },
      ],
    },
  ],
  // One comment and one reply, with two people agreeing.
  'review:sug-sofia-clash': [
    {
      id: 'c_clash_1',
      author: 'Tomas Eriksen',
      when: 'Today, 08:44',
      content: text(
        "Marketing's weekly note uses store credit in Norway orders. If this goes live, the note changes from November too.",
      ),
      reactions: [{ emoji: '👍', by: ['Sofia Brandt', 'Jon Abara'] }],
      replies: [
        {
          id: 'c_clash_2',
          author: 'Sofia Brandt',
          when: 'Today, 09:02',
          content: text("Yes, from 1 November. I'll tell Finance the note follows the same rule."),
        },
      ],
    },
  ],
  // A question for the suggester: the mention brings the suggestion back to Jon's Inbox, in the app only.
  'review:sug-jon': [
    {
      id: 'c_jon_1',
      author: 'Tomas Eriksen',
      when: 'Today, 10:05',
      content: text(
        '@[Jon Abara] which part of the budget is held: media, or agency fees too? Finance asks for the line before I publish.',
      ),
    },
  ],
  // A mention on someone else's context item: Jon owns no Marketing context, so it reaches him only as a mention.
  'context:itm_za26xpzv': [
    {
      id: 'c_reg_1',
      author: 'Tomas Eriksen',
      when: 'Today, 09:31',
      content: text(
        '@[Jon Abara] with the customs stop since 4 August, should this say paid campaigns would have stopped anyway? Agents mix the two up.',
      ),
      reactions: [{ emoji: '👀', by: ['Priya Nair'] }],
    },
  ],
  // A longer thread on a context item, with an edited comment, a deleted one and reactions.
  'context:itm_norway_stop': [
    {
      id: 'c_norway_1',
      author: 'Maria Lindqvist',
      when: '16 Oct',
      content: text('Is this still true? The customs page was updated on 15 October.'),
      reactions: [{ emoji: '👀', by: ['Jon Abara'] }],
      replies: [
        {
          id: 'c_norway_2',
          author: 'Jon Abara',
          when: '16 Oct',
          content: text(
            'Still true. The update only adds a form for returns:\n\n- Parcels are still held at the border\n- Nothing changes for orders before 4 August',
          ),
          reactions: [{ emoji: '✅', by: ['Maria Lindqvist'] }],
        },
        {
          id: 'c_norway_3',
          author: 'Noor Haddad',
          when: '17 Oct',
          deleted: true,
          content: text(''),
        },
        {
          id: 'c_norway_5',
          author: 'Maria Lindqvist',
          when: '17 Oct',
          content: text('Thanks, that settles it for the weekly note.'),
        },
      ],
    },
    {
      id: 'c_norway_4',
      author: 'Tomas Eriksen',
      when: '20 Oct',
      edited: true,
      content: text(
        'Paid media for Norway is paused until this ends, so spend there will read as zero in October too.',
      ),
      reactions: [{ emoji: '🙏', by: ['Jon Abara', 'Sofia Brandt'] }],
    },
  ],
}

/** The newest reply someone else wrote on a thread the owner already answered: what brings a card back to "Needs you". */
export const newReplies: Partial<Record<Subject, NewReply>> = {
  'review:sug-lars-retire': { from: 'Lars Dahl', when: 'Today, 08:50', excerpt: LARS_REPLY },
}
