import type { UIMessageChunk } from 'ai'
import type { AskMessage } from '@/lib/assistant'

/*
  Reads the assistant's stream into its message, chunk by chunk, as the AI SDK's own reader does
  (readUIMessageStream): the same parts in the same states, so the conversation goes back to the
  service in the shape it validates. The browser carries this small reader instead of the SDK's
  chat client, whose schema library would grow the first load of every page (the panel is lazy,
  but that library's core is shared with the app's own). tests/unit/ask-stream.test.ts holds it to
  the SDK's reader on turns recorded from the service.
*/

type Part = AskMessage['parts'][number]

/** Where the stream is in the message: which part each open text or reasoning id writes to. */
export type StreamState = { open: Map<string, number> }

export const newStreamState = (): StreamState => ({ open: new Map() })

/** An answer that stopped with an error chunk: the service's words for why. */
export class StreamError extends Error {}

function toolIndex(parts: Part[], toolCallId: string) {
  return parts.findIndex(
    (part) =>
      (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) &&
      (part as { toolCallId?: string }).toolCallId === toolCallId,
  )
}

/** Writes one tool call's new state over what the part held, or adds the part. */
function upsertTool(
  parts: Part[],
  chunk: { toolCallId: string; toolName?: string; dynamic?: boolean },
  next: Record<string, unknown>,
): Part[] {
  const index = toolIndex(parts, chunk.toolCallId)
  if (index >= 0) return parts.map((part, i) => (i === index ? { ...part, ...next } : part))
  const head =
    chunk.dynamic === false && chunk.toolName
      ? { type: `tool-${chunk.toolName}`, toolCallId: chunk.toolCallId }
      : { type: 'dynamic-tool', toolName: chunk.toolName ?? '', toolCallId: chunk.toolCallId }
  return [...parts, { ...head, ...next } as Part]
}

/**
 * The message after one chunk. `start` and `finish` carry the message's id and metadata; an
 * `error` chunk throws a `StreamError` with its words, which ends the answer as failed.
 */
export function applyChunk(
  message: AskMessage,
  chunk: UIMessageChunk,
  state: StreamState,
): AskMessage {
  const parts = message.parts
  const set = (next: Part[]) => ({ ...message, parts: next })
  switch (chunk.type) {
    case 'start':
      return {
        ...message,
        ...(chunk.messageId ? { id: chunk.messageId } : {}),
        ...(chunk.messageMetadata
          ? { metadata: { ...message.metadata, ...chunk.messageMetadata } }
          : {}),
      }
    case 'finish':
    case 'message-metadata':
      return chunk.messageMetadata
        ? { ...message, metadata: { ...message.metadata, ...chunk.messageMetadata } }
        : message
    case 'start-step':
      return set([...parts, { type: 'step-start' }])
    case 'finish-step':
      state.open.clear()
      return message
    case 'text-start':
    case 'reasoning-start': {
      const type = chunk.type === 'text-start' ? 'text' : 'reasoning'
      state.open.set(`${type}:${chunk.id}`, parts.length)
      return set([...parts, { type, text: '', state: 'streaming' }])
    }
    case 'text-delta':
    case 'reasoning-delta': {
      const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
      const index = state.open.get(`${type}:${chunk.id}`)
      if (index === undefined) return message
      return set(
        parts.map((part, i) =>
          i === index
            ? ({ ...part, text: (part as { text: string }).text + chunk.delta } as Part)
            : part,
        ),
      )
    }
    case 'text-end':
    case 'reasoning-end': {
      const type = chunk.type === 'text-end' ? 'text' : 'reasoning'
      const index = state.open.get(`${type}:${chunk.id}`)
      if (index === undefined) return message
      state.open.delete(`${type}:${chunk.id}`)
      return set(
        parts.map((part, i) => (i === index ? ({ ...part, state: 'done' } as Part) : part)),
      )
    }
    case 'tool-input-start':
      return set(upsertTool(parts, chunk, { state: 'input-streaming', input: undefined }))
    case 'tool-input-delta':
      return message
    case 'tool-input-available':
      return set(upsertTool(parts, chunk, { state: 'input-available', input: chunk.input }))
    case 'tool-input-error':
      return set(
        upsertTool(parts, chunk, {
          state: 'output-error',
          input: chunk.input,
          errorText: chunk.errorText,
        }),
      )
    case 'tool-approval-request': {
      const index = toolIndex(parts, chunk.toolCallId)
      if (index < 0) return message
      // The service signs each request; the confirmation must carry the signature back, or the
      // service refuses to run the call.
      const approval = {
        id: chunk.approvalId,
        ...(chunk.approvalDescriptor != null ? { descriptor: chunk.approvalDescriptor } : {}),
        ...(Object.hasOwn(chunk, 'inputSchemaInput')
          ? { inputSchemaInput: chunk.inputSchemaInput }
          : {}),
        ...(chunk.reason != null ? { requestReason: chunk.reason } : {}),
        ...(chunk.isAutomatic === true ? { isAutomatic: true } : {}),
        ...(chunk.signature != null ? { signature: chunk.signature } : {}),
      }
      return set(
        parts.map((part, i) =>
          i === index ? ({ ...part, state: 'approval-requested', approval } as Part) : part,
        ),
      )
    }
    case 'tool-output-denied':
      return set(upsertTool(parts, chunk, { state: 'output-denied' }))
    case 'tool-output-available':
      return set(upsertTool(parts, chunk, { state: 'output-available', output: chunk.output }))
    case 'tool-output-error':
      return set(upsertTool(parts, chunk, { state: 'output-error', errorText: chunk.errorText }))
    case 'error':
      throw new StreamError(chunk.errorText)
    case 'abort':
      return message
    default: {
      // Data parts (data-citations, data-limit, data-refusal), sources and files.
      const part = chunk as { type: string; id?: string; data?: unknown; transient?: boolean }
      if (part.type.startsWith('data-')) {
        if (part.transient) return message
        const { transient: _transient, ...kept } = part
        const index =
          part.id === undefined
            ? -1
            : parts.findIndex((p) => p.type === part.type && (p as { id?: string }).id === part.id)
        return index >= 0
          ? set(parts.map((p, i) => (i === index ? (kept as Part) : p)))
          : set([...parts, kept as Part])
      }
      if (part.type.startsWith('source-') || part.type === 'file')
        return set([...parts, part as Part])
      return message
    }
  }
}
