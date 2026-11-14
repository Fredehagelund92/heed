/*
  A write a screen starts and lets go of (`void write(...)`) has no failed branch unless it says
  one: when the service refuses, the person would be told nothing, or the opposite of what
  happened. This reports `void write(...)`, and `void write(...).then(...)`, unless the chain ends
  in a `.catch(...)` or a `.then(ok, failed)`. A write the screen reports goes through useReported
  (src/web/lib/reported.ts), which says it only once the service has answered.
*/

/** Whether a call chain says what happens when it fails: `.catch(f)`, or `.then(ok, failed)`. */
const handlesFailure = (call) =>
  call.callee.type === 'MemberExpression' &&
  call.callee.property.type === 'Identifier' &&
  (call.callee.property.name === 'catch' ||
    (call.callee.property.name === 'then' && call.arguments.length > 1))

/** The call a chain starts with: `write(...)` in `write(...).then(...).finally(...)`. */
function firstCall(call) {
  let node = call
  while (node.callee.type === 'MemberExpression' && node.callee.object.type === 'CallExpression') {
    if (handlesFailure(node)) return null
    node = node.callee.object
  }
  return node
}

const reported = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      noFailedBranch:
        'This write says nothing when it fails. Use useReported (src/web/lib/reported.ts), or end the chain with .catch that says what did not happen.',
    },
  },
  create(context) {
    return {
      'UnaryExpression[operator="void"] > CallExpression'(call) {
        if (handlesFailure(call)) return
        const first = firstCall(call)
        if (first?.callee.type === 'Identifier' && first.callee.name === 'write')
          context.report({ node: call, messageId: 'noFailedBranch' })
      },
    }
  },
}

/*
  The screens whose writes still go unreported, until each moves to useReported
  (src/web/lib/reported.ts). Take a file off when it no longer lets a write go without a failed
  branch; add none.
*/
export const writesStillToReport = [
  'src/web/components/heed/answer.tsx',
  'src/web/components/heed/fact-peek.tsx',
  'src/web/components/heed/loop-answer.tsx',
  'src/web/components/obs/save-question.tsx',
  'src/web/components/obs/topic-filters.tsx',
  'src/web/lib/links-switch.ts',
  'src/web/lib/threads.ts',
  'src/web/pages/ask.tsx',
  'src/web/pages/fact.tsx',
  'src/web/pages/inbox.tsx',
  'src/web/pages/observability/alerts.tsx',
  'src/web/pages/observability/overview.tsx',
  'src/web/pages/observability/quality.tsx',
  'src/web/pages/people.tsx',
  'src/web/pages/review-page.tsx',
]

export default { rules: { reported } }
