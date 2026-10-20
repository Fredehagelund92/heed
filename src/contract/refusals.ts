/**
 * What the service says when a refusal carries no words of its own, written to the voice guide
 * (docs/design/voice.md): what happened, then what to do. The contract documents them, the
 * service answers with them in place of the library's English defaults ("Forbidden", "Input
 * validation failed"), and the mock binding says the same, so a screen that shows a refusal's
 * message reads the same sentence from both.
 */
export const refusals = {
  /** 401: no session, or it ended. */
  signedOut: "You're signed out. Sign in, then try again.",
  /** 403: the person may not do this. */
  forbidden: "You can't do this. Ask the owner of the domain or an admin.",
  /** 404: it does not exist, or the person may not see it. */
  notFound: "We couldn't find it. It may have been deleted, or you may not have access.",
  /** 409: someone changed it first. */
  conflict: 'Someone changed this after you opened it. Look at the latest version, then try again.',
  /** 400: the app sent something the service cannot read, which is a bug in the app. */
  badRequest: "We couldn't read what the app sent. Reload the page, then try again.",
  /** 500: the service failed on its own. Each operation runs in one transaction. */
  failed: 'Something went wrong on our side. Nothing was changed. Try again in a minute.',
  /**
   * 403 to a change whose CSRF token doesn't match the session. The app reads the token again and
   * retries once when it gets exactly this, so the words are the marker: change them here only.
   */
  csrf: "We couldn't confirm this change came from the app. Reload the page, then try again.",
} as const

/** The plain default for an error code, or undefined for a code that always says its own. */
export const refusalOfCode: Readonly<Record<string, string>> = {
  UNAUTHORIZED: refusals.signedOut,
  FORBIDDEN: refusals.forbidden,
  NOT_FOUND: refusals.notFound,
  CONFLICT: refusals.conflict,
  BAD_REQUEST: refusals.badRequest,
  INTERNAL_SERVER_ERROR: refusals.failed,
}
