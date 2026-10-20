import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import { api, type ImportReport } from '@/api'
import { runEstimateQuery, useApiWrite } from '@/api/queries'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  FileTextIcon,
  LoaderCircleIcon,
  PlayIcon,
  UploadIcon,
} from '@/components/icons'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldHeader, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { formatUsd } from '@/lib/quality'
import { showToast } from '@/lib/toast'
import { refusalText } from './question-dialog'

/** The file the service reads at most (contract `importSchema`). */
const IMPORT_MAX = 1_000_000

/**
 * Importing test questions from a file (FR-504): YAML or JSON in the open file format, pasted or
 * chosen. Check runs a dry run that says what would be added, changed and left as it is, and
 * every entry that is wrong and why; Import saves them, only when every entry is valid.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [content, setContent] = useState('')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [checked, setChecked] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const write = useApiWrite('importTestQuestions')
  const [busy, setBusy] = useState(false)
  const showSpinner = usePendingIndicator(busy)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = async (dryRun: boolean) => {
    setFailure(null)
    if (!content.trim()) {
      setFailure('Paste the questions, or choose a file.')
      return
    }
    if (content.length > IMPORT_MAX) {
      setFailure('The file is larger than 1 MB. Split it into smaller files.')
      return
    }
    setBusy(true)
    try {
      const answer = dryRun
        ? await api.importTestQuestions({ content, dryRun: true })
        : await write.mutateAsync({ content, dryRun: false })
      setReport(answer)
      setChecked(content)
      if (answer.applied) {
        showToast(
          'The test questions are imported',
          `${answer.created.length} added, ${answer.updated.length} changed.`,
        )
        onClose()
      }
    } catch (error) {
      setFailure(refusalText(error))
    } finally {
      setBusy(false)
    }
  }
  const ready =
    report !== null &&
    checked === content &&
    report.errors.length === 0 &&
    report.created.length + report.updated.length > 0

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <DialogContent
        aria-busy={busy || undefined}
        className="flex max-h-drawer max-w-dialog-wide flex-col gap-0 overflow-hidden p-0"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 pointer-coarse:p-4">
          <DialogHeader>
            <DialogTitle>Import test questions</DialogTitle>
            <DialogDescription>
              YAML or JSON, as Export writes it: a list of questions, or a list under
              <span className="font-mono"> questions:</span>. A question with a name that exists
              replaces it.
            </DialogDescription>
          </DialogHeader>
          {failure ? (
            <Alert variant="danger" role="alert">
              <CircleAlertIcon aria-hidden />
              <AlertContent>
                <AlertTitle>Nothing was imported</AlertTitle>
                <AlertDescription>{failure}</AlertDescription>
              </AlertContent>
            </Alert>
          ) : null}
          <Field>
            <FieldHeader>
              <FieldLabel icon={FileTextIcon}>The questions</FieldLabel>
              <FieldDescription>Paste them here, or choose a file.</FieldDescription>
            </FieldHeader>
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={10}
              spellCheck={false}
              className="font-mono"
              aria-label="The questions"
            />
          </Field>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".yaml,.yml,.json,text/yaml,application/json"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void file.text().then(setContent)
              }}
            />
            <Button variant="outline" type="button" onClick={() => fileRef.current?.click()}>
              <UploadIcon aria-hidden="true" />
              Choose a file
            </Button>
          </div>
          {report && checked === content ? <ImportReportView report={report} /> : null}
        </div>
        <DialogFooter className="border-t px-6 py-4 pointer-coarse:px-4">
          <DialogClose render={<Button variant="outline" type="button" />} disabled={busy}>
            Cancel
          </DialogClose>
          {ready ? (
            <Button onClick={() => void run(false)} aria-disabled={busy || undefined}>
              {showSpinner ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              Import {report.created.length + report.updated.length}
            </Button>
          ) : (
            <Button onClick={() => void run(true)} aria-disabled={busy || undefined}>
              {showSpinner ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              Check
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportReportView({ report }: { report: ImportReport }) {
  const counts = `${report.created.length} to add, ${report.updated.length} to change, ${report.unchanged.length} unchanged.`
  if (report.errors.length)
    return (
      <Alert variant="warning" data-slot="import-report">
        <CircleAlertIcon aria-hidden />
        <AlertContent>
          <AlertTitle>
            {report.errors.length} {report.errors.length === 1 ? 'entry needs' : 'entries need'} a
            fix first
          </AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {report.errors.map((error, index) => (
                <li key={index}>
                  {error.index < 0
                    ? 'The file'
                    : `Entry ${error.index + 1}${error.id ? ` (${error.id})` : ''}`}
                  : {error.message}
                </li>
              ))}
            </ul>
            <p>{counts}</p>
          </AlertDescription>
        </AlertContent>
      </Alert>
    )
  return (
    <Alert variant="info" data-slot="import-report">
      <CircleCheckIcon aria-hidden />
      <AlertContent>
        <AlertTitle>The file is valid</AlertTitle>
        <AlertDescription>
          {counts}
          {report.created.length + report.updated.length === 0
            ? ' There is nothing to import.'
            : ''}
        </AlertDescription>
      </AlertContent>
    </Alert>
  )
}

/** Downloads the test questions as YAML: of one domain, or every domain the person maintains. */
export async function exportQuestions(area: Area | undefined) {
  const { content } = await api.exportTestQuestions(area ? { area: area.id } : {})
  const url = URL.createObjectURL(new Blob([content], { type: 'text/yaml' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `test-questions${area ? `-${area.id}` : ''}.yaml`
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Starting a full run of a domain on the live edition (FR-510, FR-516): what it tests and what it
 * would cost, read now. Above the budget the run waits for an administrator's approval.
 */
export function StartRunDialog({
  area,
  onClose,
  onStarted,
}: {
  area: Area
  onClose: () => void
  onStarted: (run: string) => void
}) {
  const estimate = useQuery(runEstimateQuery(area.id))
  const start = useApiWrite('startEvalRun')
  const [failure, setFailure] = useState<string | null>(null)
  const showSpinner = usePendingIndicator(start.isPending)
  const begin = async () => {
    if (start.isPending) return
    if (!estimate.data || estimate.data.questions === 0) {
      setFailure(
        estimate.data
          ? 'Write a test question for this domain first.'
          : 'Wait for the estimate, then try again.',
      )
      return
    }
    setFailure(null)
    try {
      const run = await start.mutateAsync({ id: area.id })
      showToast(
        run.state === 'awaiting_approval'
          ? 'The run waits for approval'
          : `${area.name} is running`,
        run.state === 'finished' ? 'Its results are ready.' : undefined,
      )
      onStarted(run.id)
    } catch (error) {
      setFailure(refusalText(error))
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !start.isPending) onClose()
      }}
    >
      <DialogContent aria-busy={start.isPending || undefined}>
        <DialogHeader>
          <DialogTitle>Run {area.name} now?</DialogTitle>
          <DialogDescription>
            Every active test question of {area.name}, asked on what AI apps get today and checked
            like a weekly run.
          </DialogDescription>
        </DialogHeader>
        {failure ? (
          <Alert variant="danger" role="alert">
            <CircleAlertIcon aria-hidden />
            <AlertContent>
              <AlertTitle>We couldn&apos;t start the run</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </AlertContent>
          </Alert>
        ) : null}
        {estimate.isPending ? (
          <Skeleton role="status" aria-label="Estimating the cost" className="h-12 w-full" />
        ) : estimate.isError ? (
          <p className="text-body text-muted-foreground">We couldn&apos;t estimate the cost.</p>
        ) : estimate.data.questions === 0 ? (
          <p className="text-body">
            {area.name} has no active test question, so there is nothing to run.
          </p>
        ) : (
          <div className="flex flex-col gap-2 text-body" data-slot="run-estimate">
            <p>
              {estimate.data.questions} {estimate.data.questions === 1 ? 'question' : 'questions'},{' '}
              {estimate.data.cells.toLocaleString('en')} tries
              {estimate.data.cached ? ` (${estimate.data.cached} reused)` : ''}.
            </p>
            <p>
              About <span className="font-bold">{formatUsd(estimate.data.costMicros)}</span>, with{' '}
              {estimate.data.modelId}.
            </p>
            {estimate.data.needsApproval ? (
              <p className="text-status-warning-fg">
                That&apos;s above the {formatUsd(estimate.data.budgetMicros)} a run may spend
                without approval, so it waits for an admin.
              </p>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button aria-disabled={start.isPending || undefined} onClick={() => void begin()}>
            {showSpinner ? (
              <LoaderCircleIcon aria-hidden className="animate-spin" />
            ) : (
              <PlayIcon aria-hidden="true" />
            )}
            Start the run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
