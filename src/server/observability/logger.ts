import { pino, type DestinationStream, type Logger } from 'pino'
import type { LogLevel } from '../config/env.ts'

/**
 * Structured JSON logs. The service records who writes and decides, never who asks, so request
 * logs carry the method, the path and the status only: no headers, bodies or query strings.
 * Redaction of credentials is a second line behind the serializers.
 */

interface LoggedRequest {
  method: string
  url: string
}

interface LoggedReply {
  statusCode: number
}

function withoutQuery(url: string): string {
  const query = url.indexOf('?')
  return query === -1 ? url : url.slice(0, query)
}

export function createLogger(options: {
  level: LogLevel
  destination?: DestinationStream
}): Logger {
  const settings = {
    name: 'heed',
    level: options.level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-heed-csrf"]',
        'res.headers["set-cookie"]',
        'headers.authorization',
        'headers.cookie',
        'headers["x-heed-csrf"]',
        // The model provider key (plan section 3.3): never logged, even inside a config or error.
        'headers["x-api-key"]',
        'apiKey',
        'modelEnv',
        '*.apiKey',
        '*.modelEnv',
        '*.headers["x-api-key"]',
        // A gateway takes its key as a bearer token.
        '*.headers.authorization',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req: (request: LoggedRequest) => ({
        method: request.method,
        path: withoutQuery(request.url),
      }),
      res: (reply: LoggedReply) => ({ statusCode: reply.statusCode }),
      err: pino.stdSerializers.err,
    },
  }
  return options.destination ? pino(settings, options.destination) : pino(settings)
}

/**
 * An error as a log may hold it where a prompt, a question or an answer could be in its message or
 * its fields (a model call, a validation of model output): its kind and codes, never its text.
 */
export function errorCode(error: unknown): { type: string; statusCode?: number; code?: string } {
  if (!(error instanceof Error)) return { type: typeof error }
  const { statusCode, code } = error as { statusCode?: unknown; code?: unknown }
  return {
    type: error.name,
    ...(typeof statusCode === 'number' ? { statusCode } : {}),
    ...(typeof code === 'string' && /^[\w.-]{1,60}$/.test(code) ? { code } : {}),
  }
}
