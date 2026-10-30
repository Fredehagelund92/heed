/** The editor starts from its address: the same path with another draft, gap or metric is a new start. */
export const editorStart = (search: Record<string, string | undefined>) =>
  ['draft', 'gap', 'metric', 'market', 'setup'].map((k) => search[k] ?? '').join('|')
