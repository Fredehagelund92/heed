import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, within } from 'storybook/test'
import { StoryApp } from './story-app'
import { productName } from '@/lib/brand'

/**
 * Administration (slice W11b; navigation decision, 12 October 2026) in the real shell with the
 * mock: Workspace (Domains, People, Sources, Limits, MCP and gateway, Import facts) and Oversight
 * (History log, Operations), with a setting open in the docked panel; adding a source and testing
 * it; an auditor's history log;
 * a section refused to an auditor, and the place refused to an owner. Ravi Kapoor is the
 * administrator, Ella Voss the auditor and Jon Abara an owner. MCP and gateway has stories of
 * its own (gateway.stories.tsx).
 */
const meta = {
  title: 'Administration/Administration',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const admin = 'per_ravi'
const phone = { viewport: { value: 'phone', isRotated: false } }

/** Every domain with its state, owner and deputy; each opens in its editor. */
export const Domains: Story = {
  render: () => <StoryApp path="/admin" person={admin} />,
}

/**
 * Creating a domain: a name is all a first domain needs, and the id follows it until it is typed.
 * The rest waits under More details.
 */
export const CreateDomain: Story = {
  render: () => <StoryApp path="/admin?section=domains" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Create a domain' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Create a domain' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Retention')
    await expect(within(dialog).getByRole('textbox', { name: 'Id' })).toHaveValue('retention')
    await expect(within(dialog).queryByRole('textbox', { name: 'Why' })).toBeNull()
  },
}

/** More details, opened: the colour, review time, channel, owner team, what it is and its team. */
export const CreateDomainDetails: Story = {
  render: () => <StoryApp path="/admin?section=domains" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Create a domain' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Create a domain' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Retention')
    await userEvent.click(within(dialog).getByRole('button', { name: /More details/ }))
    await expect(within(dialog).getByRole('combobox', { name: 'Owners' })).toBeVisible()
  },
}

/**
 * Deleting a domain that holds accepted items, in one step: what goes with it, named by kind, and
 * the Delete domain button disabled until `permanently delete` is typed.
 */
export const DeleteDomain: Story = {
  render: () => <StoryApp path="/admin?section=domains" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete Sales' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Sales?' })
    const lines = await within(dialog).findByRole('list', { name: 'What deleting Sales does' })
    await userEvent.click(within(lines).getByRole('button', { name: 'See the facts' }))
    await expect(within(dialog).getByRole('button', { name: 'Delete domain' })).toBeDisabled()
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Type permanently delete to confirm' }),
      'permanently delete',
    )
    await expect(within(dialog).getByRole('button', { name: 'Delete domain' })).toBeEnabled()
  },
}

/** A domain deleted with what it held: what happened, how to restore it, and Undo. */
export const DeleteDomainDone: Story = {
  render: () => <StoryApp path="/admin?section=domains" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete Sales' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Sales?' })
    await within(dialog).findByRole('list', { name: 'What deleting Sales does' })
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Type permanently delete to confirm' }),
      'permanently delete',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete domain' }))
    await expect(
      await within(dialog).findByRole('button', { name: 'Undo: restore it' }),
    ).toBeVisible()
  },
}

/** Deleting a domain that holds nothing: deleted for good, and the way to create it again. */
export const DeleteDomainEmpty: Story = {
  render: () => <StoryApp path="/admin?section=domains" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Create a domain' }, { timeout: 10_000 }),
    )
    const create = await screen.findByRole('dialog', { name: 'Create a domain' })
    await userEvent.type(within(create).getByRole('textbox', { name: 'Name' }), 'Oops')
    await userEvent.click(within(create).getByRole('button', { name: 'Create domain' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete Oops' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Oops?' })
    await within(dialog).findByText("Oops is empty, so it's deleted for good.", {
      exact: false,
    })
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Type permanently delete to confirm' }),
      'permanently delete',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete domain' }))
    await expect(
      await within(dialog).findByRole('button', { name: 'Undo: create it again' }),
    ).toBeVisible()
  },
}

/** A deleted domain below the domains: what restoring gives back, and its Restore. */
export const DeletedDomains: Story = {
  render: () => <StoryApp path="/admin?section=domains" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete Sales' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Sales?' })
    await within(dialog).findByRole('list', { name: 'What deleting Sales does' })
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Type permanently delete to confirm' }),
      'permanently delete',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete domain' }))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Close' }))
    await expect(
      await screen.findByRole('button', { name: 'Restore Sales' }, { timeout: 10_000 }),
    ).toBeVisible()
  },
}

/** The limits by group, each with its value in words and when it last changed. */
/**
 * About our business: the text in the editor item text uses, its lists showing as typed, with
 * mentions off; under it what the assistant and AI apps get, and the history.
 */
export const AboutOurBusiness: Story = {
  render: () => <StoryApp path="/admin?section=business" person={admin} />,
  play: async () => {
    const text = await screen.findByRole(
      'textbox',
      { name: 'About our business' },
      { timeout: 10_000 },
    )
    await expect(within(text).getAllByRole('listitem').length).toBeGreaterThan(0)
  },
}

export const Limits: Story = {
  render: () => <StoryApp path="/admin?section=limits" person={admin} />,
}

/** A setting in the docked panel: what it does, its form and the reason it needs. */
export const LimitOpen: Story = {
  render: () => (
    <StoryApp path="/admin?section=limits&setting=limits.mcp_requests_per_minute" person={admin} />
  ),
}

/** The settings did not load: what failed, and Try again. */
export const LimitsError: Story = {
  render: () => <StoryApp path="/admin?section=limits" person={admin} scenario="error" />,
}

/** Everyone Heed knows, with the roles they hold and when they last signed in. */
export const People: Story = {
  render: () => <StoryApp path="/admin?section=people" person={admin} />,
}

/** A person's sheet: every role they hold, since when and from whom, and the role history. */
export const PersonSheet: Story = {
  render: () => <StoryApp path="/admin?section=people&person=per_jon" person={admin} />,
}

/** The people who have left or were erased: never offered in a picker, listed when asked. */
export const PeopleWhoLeft: Story = {
  render: () => <StoryApp path="/admin?section=people&status=left" person={admin} />,
}

/** A search that finds nobody says what to try. */
export const PeopleNoMatch: Story = {
  render: () => <StoryApp path="/admin?section=people&q=zz" person={admin} />,
}

/**
 * Giving a role: the person picker finds people on the server by any part of the name or the
 * email and shows the address under each name; nobody who has left is offered.
 */
export const GiveARole: Story = {
  render: () => <StoryApp path="/admin?section=people" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Give a role' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Give a role' })
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'People' }), 'per_s')
    await expect(await screen.findByRole('option', { name: /Sofia Brandt/ })).toHaveTextContent(
      'per_sofia@example.test',
    )
  },
}

/** A picker search that finds nobody says what to try. */
export const GiveARoleNoMatch: Story = {
  render: () => <StoryApp path="/admin?section=people" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Give a role' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Give a role' })
    // Hanna Holm has left: the picker does not offer her.
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'People' }), 'hanna')
    await expect(await screen.findByText(/Nobody active matches/)).toBeVisible()
  },
}

/** The history log's person filter finds people who left too, marked, to read what they did. */
export const HistoryLogPersonFilter: Story = {
  render: () => <StoryApp path="/admin?section=audit" person={admin} />,
  play: async () => {
    await userEvent.type(
      await screen.findByRole('combobox', { name: 'Person' }, { timeout: 10_000 }),
      'hanna',
    )
    const leaver = await screen.findByRole('option', { name: /Hanna Holm/ })
    await expect(leaver).toHaveTextContent('Left')
    await userEvent.click(leaver)
    await expect(screen.getByRole('combobox', { name: 'Person' })).toHaveValue('Hanna Holm')
  },
}

/** The people list when the service does not answer. */
export const PeopleError: Story = {
  render: () => <StoryApp path="/admin?section=people" person={admin} scenario="error" />,
}

/** Giving a role to several people in several domains, with what will happen before it does. */
export const GiveRoles: Story = {
  render: () => <StoryApp path="/admin?section=people" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Give a role' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Give a role' })
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'People' }), 'Kofi')
    await userEvent.click(await screen.findByRole('option', { name: /Kofi Mensah/ }))
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Domains' }), 'Mark')
    await userEvent.click(await screen.findByRole('option', { name: /Marketing/ }))
    await expect(dialog).toHaveTextContent(
      'Kofi Mensah takes over from Tomas Eriksen as owner of Marketing.',
    )
  },
}

/** Replacing an owner on the domain's Team tab, in one step: the domain is never without one. */
export const ReplaceOwner: Story = {
  render: () => <StoryApp path="/health?open=domain:area_marketing&tab=team" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Replace Tomas Eriksen as owner' },
        { timeout: 10_000 },
      ),
    )
    await screen.findByRole('dialog', { name: 'Replace Tomas Eriksen as owner of Marketing' })
  },
}

/** People selected: the selection bar gives them a role, or removes one from them together. */
export const PeopleSelected: Story = {
  render: () => <StoryApp path="/admin?section=people" person={admin} />,
  play: async () => {
    for (const name of ['Select Lars Dahl', 'Select Priya Nair'])
      await userEvent.click(await screen.findByRole('checkbox', { name }, { timeout: 10_000 }))
    await expect(await screen.findByRole('region', { name: 'Selected people' })).toHaveTextContent(
      '2 selected',
    )
  },
}

/** Removing a role from the people selected: the roles they hold, and how many hold each. */
export const RemoveFromPeople: Story = {
  render: () => <StoryApp path="/admin?section=people" person={admin} />,
  play: async () => {
    for (const name of ['Select Lars Dahl', 'Select Jon Abara'])
      await userEvent.click(await screen.findByRole('checkbox', { name }, { timeout: 10_000 }))
    const bar = await screen.findByRole('region', { name: 'Selected people' })
    await userEvent.click(within(bar).getByRole('button', { name: 'Remove a role' }))
    await screen.findByRole('dialog', { name: 'Remove a role from 2 people' })
  },
}

/** The history log for an auditor: their one section, with no section links. */
export const HistoryLog: Story = {
  render: () => <StoryApp path="/admin" person="per_ella" />,
}

/**
 * The log's proposal entries: each names its proposal by number and title, linked, autosaves in
 * a row are one row, and the checks Heed ran are Heed's (A12).
 */
export const HistoryProposals: Story = {
  render: () => <StoryApp path="/admin?section=audit&action=proposal" person={admin} />,
}

/** An entry of the log in the docked panel, with everything it recorded. */
export const HistoryEntry: Story = {
  render: () => <StoryApp path="/admin?section=audit&entry=4" person={admin} />,
}

/** The scheduled jobs, the definition sources and the model spending. */
export const Operations: Story = {
  render: () => <StoryApp path="/admin?section=operations" person={admin} />,
}

/** The job runner is not running: Run now says why it cannot. */
export const RunnerStopped: Story = {
  render: () => (
    <StoryApp path="/admin?section=operations" person={admin} scenario="runner-stopped" />
  ),
}

/** Importing a file of items: paste or choose it, check it, then make the proposals. */
export const Import: Story = {
  render: () => <StoryApp path="/admin?section=import" person={admin} />,
}

/** A section that is not the auditor's says whose it is, and leads back to the history log. */
export const SectionRefused: Story = {
  render: () => <StoryApp path="/admin?section=limits" person="per_ella" />,
}

/** An owner is not offered Administration; the address opened anyway says whose it is. */
export const NotForAOwner: Story = {
  render: () => <StoryApp path="/admin" person="per_jon" />,
}

/** On a phone the sections are one menu, with the two groups under their names. */
export const PhoneSections: Story = {
  globals: phone,
  render: () => <StoryApp path="/admin?section=limits" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Section: Limits' }, { timeout: 10_000 }),
    )
    await expect(await screen.findByText('Oversight')).toBeVisible()
  },
}

/** Adding a source starts with the connectors this server has, by what they sync. */
export const AddConnectorList: Story = {
  render: () => <StoryApp path="/admin?section=sources&add=true" person={admin} />,
  play: async () => {
    const list = await screen.findByRole(
      'list',
      { name: 'Definitions connectors' },
      { timeout: 10_000 },
    )
    await expect(
      within(list).getByRole('link', { name: 'Static list of definitions' }),
    ).toBeVisible()
    await expect(within(list).getByText('Experimental')).toBeVisible()
  },
}

/** The connectors on a phone: each row still says what the connector reads. */
export const AddConnectorListPhone: Story = {
  globals: phone,
  render: () => <StoryApp path="/admin?section=sources&add=true" person={admin} />,
  play: async () => {
    await expect(
      await screen.findByRole('list', { name: 'Definitions connectors' }, { timeout: 10_000 }),
    ).toBeVisible()
  },
}

/**
 * Adding a source of a connector: what it reads and the access it needs, the form its manifest
 * declares, and a test read that keeps nothing and says what Heed would hold.
 */
export const AddSource: Story = {
  render: () => <StoryApp path="/admin?section=sources&add=true&connector=cube" person={admin} />,
  play: async () => {
    const form = await screen.findByRole(
      'form',
      { name: 'Add Cube model in a Git repository' },
      { timeout: 10_000 },
    )
    await userEvent.type(
      within(form).getByRole('textbox', { name: 'Repository' }),
      'https://git.example.com/analytics/semantic-layer.git',
    )
    await userEvent.click(within(form).getByRole('button', { name: 'Test connection' }))
    await expect(await screen.findByText(`${productName} can read it, with warnings`)).toBeVisible()
  },
}

/**
 * A connector written to interface 3: its form drawn from its manifest (a JSON field, domain
 * names under More settings), and its check step by step.
 */
export const AddStaticList: Story = {
  render: () => (
    <StoryApp path="/admin?section=sources&add=true&connector=static-definitions" person={admin} />
  ),
  play: async () => {
    const form = await screen.findByRole(
      'form',
      { name: 'Add Static list of definitions' },
      { timeout: 10_000 },
    )
    const definitions = within(form).getByRole('textbox', { name: 'Definitions' })
    await userEvent.click(definitions)
    await userEvent.paste(
      '[{"kind": "metric", "name": "payments.orders", "title": "Orders", "domain": "area_paid_media"}, {"kind": "dimension", "name": "payments.market"}]',
    )
    await userEvent.click(within(form).getByRole('button', { name: 'Test connection' }))
    await expect(await screen.findByText('Every metric names its domain.')).toBeVisible()
  },
}

/** A test that cannot read says why, in the failure's own words; Add connector says what is missing. */
export const AddSourceProblems: Story = {
  globals: phone,
  render: () => <StoryApp path="/admin?section=sources&add=true&connector=cube" person={admin} />,
  play: async () => {
    const form = await screen.findByRole(
      'form',
      { name: 'Add Cube model in a Git repository' },
      { timeout: 10_000 },
    )
    await userEvent.type(
      within(form).getByRole('textbox', { name: 'Repository' }),
      'https://unreachable.example.com/analytics.git',
    )
    await userEvent.click(within(form).getByRole('button', { name: 'Test connection' }))
    await expect(await screen.findByText("We couldn't reach the repository")).toBeVisible()
    await userEvent.click(within(form).getByRole('button', { name: 'Add connector' }))
    await expect(await within(form).findByText('Give the source a name.')).toBeVisible()
  },
}

/**
 * Proposing a source's members as terms: the metrics the source gives no domain come first, as a
 * group of their own that says what they need, with one choice that puts them all in a domain.
 */
export const ProposeTermsWithoutDomain: Story = {
  render: () => (
    <StoryApp
      path="/admin?section=sources&source=cube&terms=true"
      person={admin}
      scenario="no-terms"
    />
  ),
  play: async () => {
    await expect(
      await screen.findByRole('list', { name: 'Metrics without a domain' }, { timeout: 10_000 }),
    ).toBeVisible()
  },
}
