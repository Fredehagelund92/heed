/*
  One motion guard rail the class rules cannot hold, because it reads a class next to another
  (docs/design/motion.md, "Reduced motion"): the tokens carry reduced motion in one block, so a
  component adds no `motion-reduce:` override of its own. The one exception is a component's own
  keyframes (`animate-[countdown_...]`, `animate-[readfill_...]`), which the tokens do not reach:
  `motion-reduce:animate-none` may stand only in a class list that runs one.
*/

const animateNone = /^(?:\S*:)?motion-reduce:(?:\S*:)?animate-none$/
const ownKeyframes = /^(?:\S*:)?animate-\[/

const onlyForOwnKeyframes = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      override:
        '"{{found}}" overrides reduced motion. The tokens carry it (docs/design/motion.md); only a class list that runs its own keyframes stops them.',
    },
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text !== 'string' || !text.includes('motion-reduce:')) return
      const classes = text.split(/\s+/)
      if (classes.some((name) => ownKeyframes.test(name))) return
      for (const found of classes.filter((name) => animateNone.test(name)))
        context.report({ node, messageId: 'override', data: { found } })
    }
    return {
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.cooked),
    }
  },
}

export default { rules: { 'animate-none': onlyForOwnKeyframes } }
