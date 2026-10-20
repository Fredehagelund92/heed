import { domainHues } from '@domain/item'
import { itemDisplayStatuses } from '@domain/status'
import { HeedDomainIcon, HeedRecheckDueIcon, heedMarks } from '@/components/icons'
import { CountBadge, DateBadge, Owner, StatusBadge } from '@/components/item/item-marks'
import { MentionChip } from '@/components/item/mention-chip'
import { Page, PageContent } from '@/components/page/page'
import { Badge } from '@/components/ui/badge'

/** The colours, spacing steps, radii and type roles that tokens.css defines, drawn from the tokens themselves. */

const colourGroups = [
  ['Surface', ['background', 'card', 'popover', 'muted', 'accent', 'sidebar', 'selected']],
  ['Ink', ['foreground', 'muted-foreground', 'ink', 'input']],
  // The one product accent (contract 6.1): the main button, the ring and the link ink.
  // eslint-disable-next-line brand/no-product-name -- a design-system name, renamed with the marks (docs/rename-checklist.md)
  ['Heed blue', ['primary', 'ring', 'brand-ink']],
  // Two line weights (contract 8.12): inside data, and for structure.
  ['Lines', ['border-subtle', 'border']],
  ['Item kinds', ['type-event-dot', 'type-note-dot', 'type-guide-dot', 'type-example-dot']],
  [
    'Domain hues',
    [
      'hue-teal-dot',
      'hue-sky-dot',
      'hue-indigo-dot',
      'hue-violet-dot',
      'hue-pink-dot',
      'hue-lime-dot',
      'hue-stone-dot',
      'hue-gray-dot',
    ],
  ],
  [
    'Status',
    ['status-success-icon', 'status-warning-icon', 'status-info-icon', 'status-danger-icon'],
  ],
] as const

// Class names are written out in full so Tailwind can see every one of them.
const swatchClass: Record<string, string> = {
  background: 'bg-background',
  card: 'bg-card',
  popover: 'bg-popover',
  muted: 'bg-muted',
  accent: 'bg-accent',
  sidebar: 'bg-sidebar',
  selected: 'bg-selected',
  foreground: 'bg-foreground',
  'muted-foreground': 'bg-muted-foreground',
  primary: 'bg-primary',
  ink: 'bg-ink',
  'brand-ink': 'bg-brand-ink',
  input: 'bg-input',
  ring: 'bg-ring',
  // A line is drawn as one: the swatch's own border.
  'border-subtle': 'border-border-subtle',
  border: 'border-border',
  'type-event-dot': 'bg-type-event-dot',
  'type-note-dot': 'bg-type-note-dot',
  'type-guide-dot': 'bg-type-guide-dot',
  'type-example-dot': 'bg-type-example-dot',
  'hue-teal-dot': 'bg-hue-teal-dot',
  'hue-sky-dot': 'bg-hue-sky-dot',
  'hue-indigo-dot': 'bg-hue-indigo-dot',
  'hue-violet-dot': 'bg-hue-violet-dot',
  'hue-pink-dot': 'bg-hue-pink-dot',
  'hue-lime-dot': 'bg-hue-lime-dot',
  'hue-stone-dot': 'bg-hue-stone-dot',
  'hue-gray-dot': 'bg-hue-gray-dot',
  'status-success-icon': 'bg-status-success-icon',
  'status-warning-icon': 'bg-status-warning-icon',
  'status-info-icon': 'bg-status-info-icon',
  'status-danger-icon': 'bg-status-danger-icon',
}

const spacingSteps = [
  ['4', 'w-1'],
  ['8', 'w-2'],
  ['12', 'w-3'],
  ['16', 'w-4'],
  ['24', 'w-6'],
  ['32', 'w-8'],
  ['48', 'w-12'],
  ['64', 'w-16'],
] as const

const radii = [
  ['sm', 'rounded-sm'],
  ['badge', 'rounded-badge'],
  ['md', 'rounded-md'],
  ['lg', 'rounded-lg'],
  ['xl', 'rounded-xl'],
] as const

const typeRoles = [
  ['caption 12/16', 'text-caption'],
  ['dense 13/20', 'text-dense'],
  ['body 14/20', 'text-body'],
  ['large 16/24', 'text-large font-bold tracking-large'],
  ['title 20/28', 'text-title font-bold tracking-title'],
  ['display 24/32', 'text-display font-bold tracking-display'],
] as const

export function TokensPreview() {
  return (
    <Page title="Tokens" data-template="tokens">
      <PageContent width="overview" className="gap-8">
        {colourGroups.map(([label, names]) => (
          <section key={label} className="flex flex-col gap-3">
            <h2 className="text-large font-bold tracking-large">{label}</h2>
            <div className="flex flex-wrap gap-4">
              {names.map((name) => (
                <div key={name} className="flex w-16 flex-col gap-1">
                  <div className={`h-12 rounded-md border ${swatchClass[name] ?? ''}`} />
                  <span className="truncate text-caption text-muted-foreground">{name}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
        <section className="flex flex-col gap-3">
          <h2 className="text-large font-bold tracking-large">Spacing scale</h2>
          <div className="flex flex-col gap-2">
            {spacingSteps.map(([step, width]) => (
              <div key={step} className="flex items-center gap-3">
                <div className={`h-3 bg-primary ${width}`} />
                <span className="font-mono text-caption text-muted-foreground">{step}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-large font-bold tracking-large">Radius</h2>
          <div className="flex flex-wrap gap-4">
            {radii.map(([name, radius]) => (
              <div key={name} className={`size-12 border bg-muted ${radius}`} title={name} />
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-3">
          {/* eslint-disable-next-line brand/no-product-name -- a design-system name, renamed with the marks (docs/rename-checklist.md) */}
          <h2 className="text-large font-bold tracking-large">Heed marks</h2>
          <div className="flex flex-wrap items-center gap-4 text-muted-foreground heed-ink">
            {Object.entries(heedMarks).map(([name, Mark]) => (
              <Mark key={name} role="img" aria-label={name} className="size-6" />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4" data-tone="warning">
            {Object.entries(heedMarks).map(([name, Mark]) => (
              <Mark key={name} aria-hidden="true" className="size-icon-status text-tone-dot" />
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-large font-bold tracking-large">Badges</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Badge form="soft" tone="teal" icon={HeedDomainIcon}>
              Soft
            </Badge>
            <Badge form="outline" tone="teal" icon={HeedDomainIcon}>
              Outline
            </Badge>
            <Badge form="bare" tone="teal" icon={HeedDomainIcon}>
              Bare
            </Badge>
            <Badge form="solid">3</Badge>
            <Badge form="soft" tone="warning" icon={HeedRecheckDueIcon} size="sm">
              Small
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {domainHues.map((hue) => (
              <Badge key={hue} form="soft" tone={hue} icon={HeedDomainIcon}>
                {hue}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-dense">
            {itemDisplayStatuses.map((status) => (
              <StatusBadge key={status} status={status} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-dense">
            <DateBadge date={null} today="2026-10-07" />
            <DateBadge date="2026-10-31" today="2026-10-07" />
            <DateBadge date="2026-10-04" today="2026-10-07" deadline />
            <Owner name="Noor Haddad" initials="NH" chip />
            <CountBadge count={38} />
            <CountBadge count={3} tone="ink" />
            <CountBadge count={96} tone="attention" />
          </div>
          <p className="max-w-prose text-body">
            Mentions read as chips:{' '}
            <MentionChip target={{ type: 'area', label: 'violet' }} name="Paid media" /> and{' '}
            <MentionChip target={{ type: 'metric' }} name="New customers" />.
          </p>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-large font-bold tracking-large">Type</h2>
          {typeRoles.map(([name, role]) => (
            <p key={name} className={role}>
              {name}: the quick brown fox 0123456789
            </p>
          ))}
        </section>
      </PageContent>
    </Page>
  )
}
