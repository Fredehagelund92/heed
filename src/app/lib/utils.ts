export { cn } from 'cn'

/** "Ada", "Ada and Jon", "Ada, Bo and Jon". */
export const and = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
