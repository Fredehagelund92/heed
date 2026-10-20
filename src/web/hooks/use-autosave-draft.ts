import { useEffect, useRef, useState } from 'react'
import { api, ApiError, toApiError, type ProposalRecord } from '@/api'
import { useApiWrite } from '@/api/queries'
import { useAutosave } from '@/hooks/use-autosave'
import {
  changeReasonProblem,
  contextTextFindings,
  formToDraft,
  hasDraftContent,
  type ContextFormValues,
} from '@/lib/context-form'

export function useAutosaveDraft({
  value,
  initialValue,
  initialProposal,
  itemId,
  backupKey,
  onCreated,
  enabled = true,
}: {
  value: ContextFormValues
  initialValue: ContextFormValues
  initialProposal?: ProposalRecord
  itemId?: string
  backupKey: string
  onCreated: (proposal: ProposalRecord) => void
  enabled?: boolean
}) {
  const create = useApiWrite('createProposal')
  const update = useApiWrite('saveDraft')
  const [proposal, setProposal] = useState(initialProposal)
  const current = useRef(initialProposal)
  const savedInput = useRef(initialProposal ? JSON.stringify(initialValue) : '')
  const [savedValue, setSavedValue] = useState(initialProposal ? JSON.stringify(initialValue) : '')
  const lastError = useRef<unknown>(null)
  const previousBackupKey = useRef(backupKey)

  const save = async (snapshot: ContextFormValues) => {
    try {
      const sensitive = contextTextFindings(snapshot)
      if (sensitive.length)
        throw new ApiError('invalid', 'Remove sensitive text before saving.', {
          findings: sensitive,
        })
      const prior = current.current
      let next: ProposalRecord
      const draft = formToDraft(snapshot, prior?.draft)
      // Only a change to an item says what is wrong with the current version (heed-ux B5); one
      // the form refuses stays out, and the field says why.
      const reason =
        itemId && !changeReasonProblem(snapshot.reason) ? { reason: snapshot.reason } : {}
      if (prior) {
        try {
          next = await update.mutateAsync({
            id: prior.id,
            revision: prior.revision,
            draft,
            ...reason,
          })
        } catch (error) {
          const failure = toApiError(error)
          if (failure.kind !== 'conflict') throw failure
          const fresh = failure.current ?? (await api.getProposal(prior.id))
          if (!fresh || !['draft', 'changes_requested'].includes(fresh.state)) throw failure
          // Rebase only the revision and server-owned fields. Typed text remains this snapshot.
          next = await update.mutateAsync({
            id: fresh.id,
            revision: fresh.revision,
            draft: formToDraft(snapshot, fresh.draft),
            ...reason,
          })
        }
      } else {
        next = await create.mutateAsync({
          draft,
          ...(itemId ? { itemId } : {}),
          ...reason,
          channel: 'form',
        })
      }
      current.current = next
      savedInput.current = JSON.stringify(snapshot)
      setSavedValue(JSON.stringify(snapshot))
      lastError.current = null
      setProposal(next)
      if (!prior) onCreated(next)
      return next
    } catch (error) {
      lastError.current = error
      throw error
    }
  }

  const safe = contextTextFindings(value).length === 0
  const meaningful = Boolean(
    value.areaId && hasDraftContent({ summaryMarkup: value.summaryMarkup, scope: value.scope }),
  )
  const autosave = useAutosave({
    value,
    initialSavedValue: initialValue,
    save,
    enabled: enabled && meaningful && safe,
    shouldRetry: (error) => toApiError(error).retryable,
  })

  useEffect(() => {
    if (previousBackupKey.current !== backupKey) {
      try {
        localStorage.removeItem(previousBackupKey.current)
      } catch {
        /* Storage may be unavailable. */
      }
      previousBackupKey.current = backupKey
    }
    // Nothing to keep: what the service has, or a new form as it opened, prefilled or not (a
    // capture link left untouched must not come back on the next Add context).
    const unchanged = savedInput.current || JSON.stringify(initialValue)
    if (JSON.stringify(value) === unchanged) {
      try {
        localStorage.removeItem(backupKey)
      } catch {
        /* Storage may be unavailable. */
      }
    } else if (safe) {
      try {
        localStorage.setItem(backupKey, JSON.stringify(value))
      } catch {
        /* The leave guard still protects the in-memory draft. */
      }
    }
  }, [value, proposal, safe, backupKey, initialValue])

  return {
    ...autosave,
    proposal,
    unsaved:
      enabled &&
      JSON.stringify(value) !== JSON.stringify(initialValue) &&
      JSON.stringify(value) !== savedValue,
    async saveNow() {
      await autosave.flush()
      if (lastError.current) throw toApiError(lastError.current)
      if (!current.current || savedInput.current !== JSON.stringify(value)) return save(value)
      return current.current
    },
  }
}
