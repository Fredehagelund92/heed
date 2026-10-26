import { generateText } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import type { CommentItem } from '@/components/templates/comment-box/types'
import { EXTENSIONS } from '@/components/templates/comment-box/extensions'
import { text } from '@/components/templates/comment-box/utils'
import { answerFor } from '@/api/mock/data/ask'
import { seedComments } from '@/api/mock/data/comments'
import { factById, facts } from '@/api/mock/data/world'
import { agentReply } from '@/lib/agent-reply'
import { createMockApi } from '@/api/mock'
import { mentionsIn, plainText } from '@/lib/mentions'

// Agents never read comments. A comment can disagree with the item it hangs on, and it was never
// checked, so nothing an agent gets may carry one: not the reply, not the sentence to relay.

const words = (list: CommentItem[] = []) =>
  list
    .flatMap((c) => [c, ...(c.replies ?? [])])
    .map((c) => generateText(c.content, EXTENSIONS).trim())
    .filter(Boolean)

/** Everything an agent could get for every context item, as the text it would read. */
function everythingAgentsGet() {
  return facts.map((f) => {
    const [metric, ...markets] = f.where
    const answer = answerFor(f.title, metric!, markets.length ? markets : ['Norway'])
    const reply = agentReply(
      answer,
      answer.sources.map((id) => factById(id)!),
    )
    return JSON.stringify(reply) + answer.text + answer.said
  })
}

describe('what agents get', () => {
  it('never holds a comment, even one that contradicts the item', async () => {
    const contradiction = 'Online sales to Norway started again on 1 October 2026.'
    const { api } = createMockApi()
    await api.postComment({ subject: 'context:itm_norway_stop', content: text(contradiction) })
    expect(JSON.stringify(await api.getComments())).toContain(contradiction)

    const comments = [...Object.values(seedComments).flatMap((list) => words(list)), contradiction]
    expect(comments.length).toBeGreaterThan(5)
    for (const got of everythingAgentsGet()) for (const c of comments) expect(got).not.toContain(c)
  })

  it('reads a mention as its words and never follows it', () => {
    // The Norway stop links to the regulator's pause (Return on ad spend) and an archived item.
    const norway = factById('itm_norway_stop')!
    expect(mentionsIn(norway.body).map((m) => m.id)).toContain('context:itm_za26xpzv')

    const answer = answerFor('Why did orders drop in Norway?', 'Orders', ['Norway'])
    expect(answer.sources).toContain('itm_norway_stop')
    expect(answer.sources).not.toContain('itm_za26xpzv')
    expect(answer.sources).not.toContain('itm_kh4llvi9')
    for (const got of everythingAgentsGet()) expect(got).not.toContain('[@')
    expect(plainText(norway.body!)).toContain('so the Webshop was the only way')
  })

  it('names only published context, with its source and who checked it', () => {
    const answer = answerFor('Why did orders drop in Norway?', 'Orders', ['Norway'])
    const reply = agentReply(
      answer,
      answer.sources.map((id) => factById(id)!),
    )
    expect(Object.keys(reply).sort()).toEqual([
      'asked',
      'context',
      'edition',
      'reply_id',
      'say',
      'status',
    ])
    for (const item of reply.context)
      expect(Object.keys(item).sort()).toEqual(['checked', 'id', 'source', 'title'])
  })
})
