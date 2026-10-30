import { DEFAULT_PRODUCT_NAME } from './src/domain/brand.ts'

/*
  The product's name is written once (src/domain/brand.ts, docs/rename-checklist.md). This reports
  a string, template text or JSX text that names it by hand. Say it with `productName`
  (src/server/brand.ts, src/web/lib/brand.ts), or leave it out where the sentence works without it.
  Comments and code names are not text a person reads, so they are not checked.
*/

const named = new RegExp(`\\b${DEFAULT_PRODUCT_NAME}\\b`)

const noProductName = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      byHand:
        'The product name is written by hand. Use productName (src/server/brand.ts or src/web/lib/brand.ts), or leave the name out. See docs/rename-checklist.md.',
    },
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text === 'string' && named.test(text))
        context.report({ node, messageId: 'byHand' })
    }
    return {
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.cooked),
      JSXText: (node) => check(node, node.value),
    }
  },
}

export default { rules: { 'no-product-name': noProductName } }
