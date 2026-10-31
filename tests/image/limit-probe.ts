/*
  One caller of the production boot check (tests/image/production-boot.sh), in a container of its
  own so it has an address of its own: it calls an address before sign-in `count` times, one after
  another, and prints how many answers were 429, as JSON. A forwarded address it sends along is
  one a caller made up: the web image's proxy must drop it.
*/

const [url, count = '1', forwardedFor] = process.argv.slice(2)
if (!url) throw new Error('Usage: node tests/image/limit-probe.ts <url> [count] [x-forwarded-for]')
const statuses: number[] = []
for (let i = 0; i < Number(count); i++) {
  const response = await fetch(url, {
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  })
  await response.arrayBuffer()
  statuses.push(response.status)
}
console.log(
  JSON.stringify({
    calls: statuses.length,
    limited: statuses.filter((status) => status === 429).length,
    last: statuses.at(-1),
  }),
)
