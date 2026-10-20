/*
  A round trip corpus for the item body (the editor design task, 9 October 2026): what authors
  type, in the Markdown subset of lib/markdown.ts and just outside it.
  canonical: what the editor writes itself, which must come back byte for byte;
  variant: another spelling of the subset, which may be normalised but must draw the same;
  outside: markup the subset refuses, which must stay the typed text.
*/
export const corpus: [string, 'canonical' | 'variant' | 'outside', string][] = [
  // ---- the long instruction the captain meant: headings, numbered steps, bullets, bold, code, quote, mentions
  [
    'long-instruction',
    'canonical',
    `## When a number moves after a market closes

Use this when a metric drops or rises in a market and nobody has said why. Work through the steps in order and stop at the first one that explains the change.

### Before you start

- Confirm the **period** and the @[market](dim:market) you were asked about.
- Check that the @[Orders](metric:orders) number comes from the source tool, not from a screenshot.
- Look for an item that already explains the change.

### Steps

1. Compare the affected market with a market that was not affected, before and after the date.
2. Read the @[Online sales stopped in Norway](item:itm_a1b2c3d4) item and its source. Do not quote it before you have opened the link.
3. If the dates overlap, say the item *might be related*. Never write "caused by".
4. Ask the owner of @[Sales](area:sales) if the cause is still unclear.

> A closure and a drop in the same week is not proof of a cause. Say what the source says and no more.

Run \`select count(*) from orders where market = 'norway'\` only through the source tool:

\`\`\`
select market, count(*) as orders
from basket.orders
where placed_on >= date '2026-08-04'
group by 1
\`\`\`

See [the closure notice](https://example.com/notices/2026-08-04) for the wording.`,
  ],
  [
    'short-fact',
    'canonical',
    'Online sales stopped in Norway on 4 August 2026. The @[Orders](metric:orders) number for @[Norway](val:market/norway) falls from that day.',
  ],
  [
    'issue-note',
    'canonical',
    `The marketplace partner for @[Norway](val:market/norway) stopped sending reports on 2 September. Numbers for the partner are low until it is fixed.

Check again on 16 September.`,
  ],
  [
    'two-paragraphs',
    'canonical',
    'First paragraph.\n\nSecond paragraph with **bold**, *italic* and `code`.',
  ],
  ['heading-2', 'canonical', '## Heading two\n\nText.'],
  ['heading-3', 'canonical', '### Heading three\n\nText.'],
  ['bullets', 'canonical', '- one\n- two\n- three'],
  ['numbered', 'canonical', '1. one\n2. two\n3. three'],
  ['numbered-start', 'canonical', '4. four\n5. five'],
  ['quote', 'canonical', '> quoted text\n> over two lines'],
  ['quote-with-list', 'canonical', '> intro\n>\n> - a\n> - b'],
  ['fence', 'canonical', '```\nconst a = 1\n```'],
  ['link', 'canonical', 'Read [the notice](https://example.com/a?b=1&c=2) first.'],
  ['mailto', 'canonical', 'Write to [the owner](mailto:owner@example.com).'],
  ['mention-only', 'canonical', '@[Net revenue](metric:net_revenue)'],
  ['mention-in-bold', 'canonical', '**see @[Net revenue](metric:net_revenue)**'],
  ['mention-adjacent', 'canonical', '@[A](metric:a)@[B](metric:b) and @[C](dim:c).'],
  ['literal-at', 'canonical', 'Ask @owner about it, not a@b.'],
  ['escaped-at-bracket', 'canonical', 'Type \\@[like this] to start a mention.'],
  ['emoji-unicode', 'canonical', 'Ä ö å – naïve café 日本語 🚀'],
  ['underscore-word', 'canonical', 'Use the snake_case_name column, not the CamelCase one.'],
  ['asterisk-math', 'canonical', 'Compute 2 * 3 * 4 and 5*6.'],
  // ---- other spellings of the same subset
  ['star-bullets', 'variant', '* one\n* two'],
  ['plus-bullets', 'variant', '+ one\n+ two'],
  ['paren-numbers', 'variant', '1) one\n2) two'],
  ['underscore-bold', 'variant', 'This is __bold__ text.'],
  ['underscore-italic', 'variant', 'This is _italic_ text.'],
  ['tilde-fence', 'variant', '~~~\ncode\n~~~'],
  ['heading-closing-hashes', 'variant', '## Heading ##\n\ntext'],
  ['heading-no-blank', 'variant', '## Heading\ntext right after'],
  ['list-no-blank', 'variant', 'Intro\n- one\n- two'],
  ['link-with-title', 'variant', '[x](https://example.com "A title")'],
  ['crlf', 'variant', 'one\r\n\r\ntwo'],
  ['multiple-blank-lines', 'variant', 'one\n\n\n\ntwo'],
  ['trailing-spaces', 'variant', 'one  \ntwo'],
  ['soft-line-break', 'variant', 'line one\nline two of the same paragraph'],
  ['list-lazy-continuation', 'variant', '- one\n  continues here\n- two'],
  // ---- outside the subset: must stay as typed
  ['nested-list', 'outside', '- parent\n  - child\n  - child two\n- parent two'],
  ['table', 'outside', '| a | b |\n| - | - |\n| 1 | 2 |'],
  ['image', 'outside', '![alt text](https://example.com/x.png)'],
  ['raw-html', 'outside', '<div class="x">hello</div>\n\n<script>alert(1)</script>'],
  ['heading-1', 'outside', '# Heading one\n\ntext'],
  ['heading-4', 'outside', '#### Heading four\n\ntext'],
  ['js-link', 'outside', '[click](javascript:alert(1))'],
  ['relative-link', 'outside', '[docs](/docs/readme)'],
  ['autolink', 'outside', 'Visit <https://example.com> now.'],
  ['hr', 'outside', 'above\n\n---\n\nbelow'],
  ['strike', 'outside', 'this is ~~struck~~ text'],
  ['task-list', 'outside', '- [ ] todo\n- [x] done'],
  ['footnote', 'outside', 'Text[^1]\n\n[^1]: the note'],
  [
    'malformed-mention',
    'outside',
    'Broken @[Net revenue](metric:Net Revenue) token and @[x](nope:y).',
  ],
  ['indented-code', 'outside', 'Text\n\n    indented code\n\nmore'],
]
