import type { FormatFinding } from '@domain/draft'

/** The text check of FR-117 in plain words: what it found and what to do instead. */
export const textCheckMessages: Record<string, string> = {
  email_address:
    'Looks like an email address. Personal data stays out of facts. Name a team or a role instead.',
  phone_number:
    'Looks like a phone number. Personal data stays out of facts. Name a team or a role instead.',
  private_key: 'Looks like a private key. Keys never go in a fact. Remove it.',
  access_key: 'Looks like an access key. Keys never go in a fact. Remove it.',
  password_or_token: 'Looks like a password or a secret. Secrets never go in a fact. Remove it.',
}

/** A finding in plain words, for a code the text check knows; other findings stay as they are. */
export function plainFinding<T extends Pick<FormatFinding, 'code' | 'message'>>(finding: T): T {
  const message = textCheckMessages[finding.code]
  return message ? { ...finding, message } : finding
}

/** What the text check found, as the start of a sentence: "An email address in the text." */
export const textCheckShort: Record<string, string> = {
  email_address: 'An email address',
  phone_number: 'A phone number',
  private_key: 'A private key',
  access_key: 'An access key',
  password_or_token: 'A password or a secret',
}
