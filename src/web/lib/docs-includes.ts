import type { DocInclude } from '@domain/docs'
import { AGENT_TOOLS, CHECKS, PROMPT } from '@/lib/agents'
import { ANSWER_LINES, WORDS } from '@/lib/help-content'
import { setupSteps } from '@/lib/setup'
import { kindHint, kindLabel, type Kind } from '@/model/items'

// The app's own lists as a docs page shows them where it names them (an include, docs/help/README.md).
// The Docs area draws each list from its source; the page's file holds the same list as Markdown,
// for GitHub and for agents, and the docs check (tests/web/docs.test.ts) keeps the two the same.

/** A word's sentence, from the ten words Help shows. */
export const wordOf = (word: string) => WORDS.find(([w]) => w === word)?.[1]

const cell = (text: string) => text.replace(/\|/g, '\\|')

/** An include's list as Markdown, or null for an include that names nothing. */
export function includeMarkdown(name: DocInclude, arg: string): string | null {
  switch (name) {
    case 'setup-steps':
      return setupSteps.map((s, i) => `${i + 1}. **${s.title}**. ${s.description}`).join('\n')
    case 'prompt':
      return ['```text title="The prompt, exactly as the app shows it"', PROMPT, '```'].join('\n')
    case 'checks':
      return CHECKS.map((c) => `- ${c}`).join('\n')
    case 'kinds':
      return (Object.keys(kindLabel) as Kind[])
        .map((k) => `- **${kindLabel[k]}**: ${kindHint[k]}`)
        .join('\n')
    case 'word':
      return wordOf(arg) ?? null
    case 'answer-lines':
      return [
        '| The line | What it means | What you do |',
        '| --- | --- | --- |',
        ...ANSWER_LINES.map(
          (a) =>
            `| ${cell(a.label)}: ${cell(a.sentence)} | ${cell(a.long)}. ${cell(a.means)} | ${cell(a.todo)} |`,
        ),
      ].join('\n')
    case 'words':
      return WORDS.map(([w, d]) => `- ${w}: ${d}`).join('\n')
    case 'tools':
      return AGENT_TOOLS.map((t) =>
        [`### ${t.name}`, '', t.what, '', `- Takes: ${t.takes}`, `- Returns: ${t.returns}`].join(
          '\n',
        ),
      ).join('\n\n')
  }
}
