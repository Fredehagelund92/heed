import { scopeText, type Answer } from '@/data/ask'
import type { Fact } from '@/data/world'

// What an agent gets back from get_context: the state, the one sentence to relay, and each context
// item with its source and who checked it. It is built from published context only. Comments and
// reactions live apart (lib/comments.ts) and nothing here reads them; agent-reply.test.ts holds
// that line.

export function agentReply(answer: Answer, facts: Fact[]) {
  const scope = scopeText(answer) || 'nothing matched'
  return {
    status: {
      grounded: 'matched',
      partial: 'matched',
      missing: 'no_match',
      conflict: 'conflict',
      stale: 'matched',
      failed: 'check_failed',
    }[answer.state],
    say: answer.said,
    asked: scope,
    context: facts.map((f) => ({
      id: f.id,
      title: f.title,
      checked: `${f.checkedBy}, ${f.checkedOn}`,
      source: f.source,
    })),
    reply_id: 'rpl_7f3a91c2',
    edition: '2026-10-22.4',
  }
}
