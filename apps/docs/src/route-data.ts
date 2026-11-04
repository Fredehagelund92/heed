import { defineRouteMiddleware } from '@astrojs/starlight/route-data'

/** "On this page" opens with the page's own title, where Starlight writes "Overview". */
export const onRequest = defineRouteMiddleware(({ locals }) => {
  const { entry, toc } = locals.starlightRoute
  if (toc?.items[0]) toc.items[0].text = entry.data.title
})
