// Which rows of a list carry a mark (components/heed/mark.tsx draws it).

/**
 * Whether a list marks its exceptions: when every row of two or more would carry the same mark,
 * none does, so the mark keeps its meaning. A list of one marks it.
 */
export const marksExceptions = <T>(rows: readonly T[], marked: (row: T) => boolean) =>
  rows.length < 2 || rows.some((row) => !marked(row))
