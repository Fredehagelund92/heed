import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { api, type ItemImportReport } from '@/api'
import { useApiWrite } from '@/api/queries'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  FilePlusIcon,
  FileTextIcon,
  HashIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  SearchIcon,
  UploadIcon,
} from '@/components/icons'
import { gridCell } from '@/components/page/grid'
import {
  GridHeaderCells,
  GridTable,
  gridRowClass,
  type GridColumn,
} from '@/components/page/grid-table'
import { PageContent } from '@/components/page/page'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BlockedButton } from '@/components/ui/blocked-button'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldHeader,
  FieldItem,
  FieldItemContent,
  FieldLabel,
} from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { ITEM_FILE_MAX_LENGTH } from '../../../domain/item-file.ts'
import { SettingsBlock } from './settings-parts'

const actionWords: Record<ItemImportReport['entries'][number]['action'], string> = {
  create: 'New fact',
  change: 'Change',
  unchanged: 'Unchanged',
}

const columns: GridColumn[] = [
  { icon: HashIcon, title: 'Entry', className: 'w-column-version' },
  { icon: FileTextIcon, title: 'Fact', className: 'min-w-0 flex-1' },
  { icon: PencilLineIcon, title: 'Makes', className: 'w-column-owner' },
]

/**
 * Importing items (FR-120): a YAML or JSON file of items, as an edition export or `heed import`
 * reads, becomes proposals through the same checks as the form, never accepted items. Check runs
 * a dry run that says what each entry would make and what is wrong with it; Make proposals runs
 * only when every entry is valid, and submits them for review unless they should stay drafts.
 */
export function ImportSection() {
  const [content, setContent] = useState('')
  const [sourceName, setSourceName] = useState<string | null>(null)
  const [submit, setSubmit] = useState(true)
  const [report, setReport] = useState<ItemImportReport | null>(null)
  const [checked, setChecked] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const write = useApiWrite('importItems')
  const [busy, setBusy] = useState(false)
  const spinning = usePendingIndicator(busy)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = async (dryRun: boolean) => {
    setFailure(null)
    if (!content.trim()) {
      setFailure('Paste the facts, or choose a file.')
      return
    }
    if (content.length > ITEM_FILE_MAX_LENGTH) {
      setFailure('The file is larger than 16 MB. Split it into smaller files.')
      return
    }
    setBusy(true)
    try {
      const input = { content, dryRun, submit, ...(sourceName ? { sourceName } : {}) }
      const answer = dryRun ? await api.importItems(input) : await write.mutateAsync(input)
      setReport(answer)
      setChecked(content)
      if (answer.applied) {
        const made = answer.counts.create + answer.counts.change
        showToast(
          `${made} ${made === 1 ? 'proposal' : 'proposals'} made`,
          submit
            ? 'The owners of their domains will look at them.'
            : 'They stay drafts until you send them for review.',
        )
      }
    } catch (error) {
      setFailure(error instanceof Error && error.message ? error.message : 'Try again.')
    } finally {
      setBusy(false)
    }
  }

  const current = report && checked === content ? report : null
  const makes = current ? current.counts.create + current.counts.change : 0
  const blocked = !current
    ? 'Check the file first.'
    : current.error
      ? 'The file itself has a problem. Fix it, then check again.'
      : current.counts.errors
        ? 'Fix the entries with a problem, then check again.'
        : makes === 0
          ? "Every entry is the same as its fact in the library, so there's nothing to propose."
          : null

  return (
    <PageContent width="overview" className="gap-8">
      <SettingsBlock
        title="Import facts"
        slot="import-block"
        description="A YAML or JSON file of facts, in the format an export writes. Each entry becomes a proposal, checked like one written in the form. An entry with an id changes that fact."
      >
        {failure ? (
          <Alert variant="danger" role="alert" className="max-w-reading">
            <CircleAlertIcon aria-hidden />
            <AlertContent>
              <AlertTitle>Nothing was imported</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </AlertContent>
          </Alert>
        ) : null}
        <div className="flex max-w-reading flex-col gap-4">
          <Field name="content">
            <FieldHeader>
              <FieldLabel icon={FileTextIcon}>The facts</FieldLabel>
              <FieldDescription>
                {sourceName ? `From ${sourceName}. ` : ''}Paste them here, or choose a file.
              </FieldDescription>
            </FieldHeader>
            <Textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value)
                setSourceName(null)
              }}
              rows={10}
              spellCheck={false}
              className="font-mono"
              aria-label="The facts"
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
                if (file)
                  void file.text().then((text) => {
                    setContent(text)
                    setSourceName(file.name.slice(0, 200))
                  })
              }}
            />
            <Button variant="outline" type="button" onClick={() => fileRef.current?.click()}>
              <UploadIcon aria-hidden="true" />
              Choose a file
            </Button>
          </div>
          <Field name="submit">
            <FieldItem>
              <Checkbox
                checked={submit}
                onCheckedChange={(checked) => setSubmit(Boolean(checked))}
              />
              <FieldItemContent>
                <FieldLabel>Send them for review</FieldLabel>
                <FieldDescription>
                  Each one goes to the owners of its domain. Leave this unticked to keep them as
                  your drafts.
                </FieldDescription>
              </FieldItemContent>
            </FieldItem>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              aria-disabled={busy || undefined}
              onClick={() => void run(true)}
            >
              {spinning ? (
                <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
              ) : (
                <SearchIcon aria-hidden />
              )}
              Check the file
            </Button>
            {blocked ? (
              <BlockedButton variant="default" reason={blocked} title="Make proposals is blocked">
                <FilePlusIcon aria-hidden />
                Make proposals
              </BlockedButton>
            ) : (
              <Button aria-disabled={busy || undefined} onClick={() => void run(false)}>
                <FilePlusIcon aria-hidden />
                Make {makes} {makes === 1 ? 'proposal' : 'proposals'}
              </Button>
            )}
          </div>
        </div>
        {current ? <ImportReportView report={current} /> : null}
      </SettingsBlock>
    </PageContent>
  )
}

function ImportReportView({ report }: { report: ItemImportReport }) {
  const { create, change, unchanged, errors } = report.counts
  const counts = `${create} new, ${change} to change, ${unchanged} unchanged.`
  return (
    <div className="flex flex-col gap-3" data-slot="import-report">
      {report.applied ? (
        <Alert className="max-w-reading">
          <CircleCheckIcon aria-hidden />
          <AlertContent>
            <AlertTitle>Proposals made</AlertTitle>
            <AlertDescription>
              <p>{counts}</p>
              <Link
                to="/proposals"
                search={{ view: 'mine' }}
                className="text-brand-ink underline underline-offset-4 hover:no-underline"
              >
                See them on Proposals
              </Link>
            </AlertDescription>
          </AlertContent>
        </Alert>
      ) : report.error ? (
        <Alert variant="warning" className="max-w-reading">
          <CircleAlertIcon aria-hidden />
          <AlertContent>
            <AlertTitle>We can&apos;t read the file</AlertTitle>
            <AlertDescription>{report.error}</AlertDescription>
          </AlertContent>
        </Alert>
      ) : errors ? (
        <Alert variant="warning" className="max-w-reading">
          <CircleAlertIcon aria-hidden />
          <AlertContent>
            <AlertTitle>
              {errors} {errors === 1 ? 'entry needs' : 'entries need'} a fix first
            </AlertTitle>
            <AlertDescription>
              {counts} Fix every entry with a problem before you make proposals.
            </AlertDescription>
          </AlertContent>
        </Alert>
      ) : (
        <Alert variant="info" className="max-w-reading">
          <CircleCheckIcon aria-hidden />
          <AlertContent>
            <AlertTitle>Every entry is ready</AlertTitle>
            <AlertDescription>{counts}</AlertDescription>
          </AlertContent>
        </Alert>
      )}
      {report.entries.length ? (
        <GridTable
          slot="import-entries"
          label="Entries of the file"
          header={<GridHeaderCells columns={columns} />}
        >
          {report.entries.map((entry) => {
            const problems = entry.findings.filter((finding) => finding.severity === 'error')
            const warnings = entry.findings.filter((finding) => finding.severity === 'warning')
            return (
              <div
                key={entry.index}
                role="row"
                data-entry-index={entry.index}
                className={gridRowClass}
              >
                <div role="cell" className={cn(gridCell, 'w-column-version tabular-nums')}>
                  {entry.index + 1}
                </div>
                <div
                  role="cell"
                  className={cn(
                    gridCell,
                    'min-w-0 flex-1 shrink flex-col items-start justify-center gap-1 py-2',
                  )}
                >
                  <span className="max-w-full truncate text-body">
                    {entry.title ?? 'Untitled entry'}
                  </span>
                  {[...problems, ...warnings].map((finding, index) => (
                    <span
                      key={index}
                      className={cn(
                        'text-dense',
                        finding.severity === 'error' ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {finding.severity === 'error' ? 'Problem' : 'Note'}
                      {finding.field ? ` in ${finding.field}` : ''}: {finding.message}
                    </span>
                  ))}
                </div>
                <div role="cell" className={cn(gridCell, 'w-column-owner')}>
                  {problems.length ? (
                    <Badge form="soft" tone="warning" icon={CircleAlertIcon} size="sm">
                      Needs a fix
                    </Badge>
                  ) : (
                    <Badge form="bare" size="sm" quiet={entry.action === 'unchanged'}>
                      {actionWords[entry.action]}
                    </Badge>
                  )}
                </div>
              </div>
            )
          })}
        </GridTable>
      ) : null}
    </div>
  )
}
