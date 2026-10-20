import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ApiError, type SignInPerson } from '@/api'
import { AuthPage } from '@/components/sign-in/auth-page'
import {
  SignInChoices,
  SignInIntro,
  SignInLoadFailed,
  SignInLoading,
} from '@/components/sign-in/sign-in-form'
import { StoryApp } from './story-app'

/**
 * The sign-in page (routes/signed-out.tsx), where every visit without a session lands. The picker
 * lists the local sign-in's demo people with their roles and the domains of those roles; Continue
 * signs in as the one chosen and goes back to where the person was. Company sign-in is not built
 * yet: its button shows only once a connector is configured (the last two stories show the place
 * it takes). Switch the theme and the viewport in the toolbar for light, dark, 1440 and 390.
 */
const meta = {
  title: 'Shell/Sign in',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const sales = { id: 'area_sales', name: 'Sales', label: 'teal' } as const
const sandbox = { id: 'area_sandbox', name: 'Sandbox', label: 'stone' } as const
const marketing = { id: 'area_marketing', name: 'Marketing', label: 'pink' } as const

const people: SignInPerson[] = [
  {
    email: 'per_maria@example.test',
    name: 'Maria Lindqvist',
    initials: 'ML',
    roles: [],
    assignments: [],
  },
  {
    email: 'per_jon@example.test',
    name: 'Jon Abara',
    initials: 'JA',
    roles: [],
    assignments: [
      { role: 'owner', area: sales },
      { role: 'owner', area: sandbox },
    ],
  },
  {
    email: 'per_sofia@example.test',
    name: 'Sofia Brandt',
    initials: 'SB',
    roles: [],
    assignments: [{ role: 'owner', area: sales }],
  },
  {
    email: 'per_tomas@example.test',
    name: 'Tomas Eriksen',
    initials: 'TE',
    roles: [],
    assignments: [
      { role: 'owner', area: marketing },
      { role: 'approver', area: sales },
    ],
  },
  {
    email: 'per_ravi@example.test',
    name: 'Ravi Kapoor',
    initials: 'RK',
    roles: ['administrator'],
    assignments: [],
  },
  {
    email: 'per_ella@example.test',
    name: 'Ella Voss',
    initials: 'EV',
    roles: ['auditor'],
    assignments: [],
  },
]

const noop = () => undefined
const company = { href: '#company-sign-in' }

function Frame({ children }: { children: ReactNode }) {
  return (
    <AuthPage title="Sign in" heading="paper">
      <SignInIntro />
      {children}
    </AuthPage>
  )
}

/** The real page on the mock: nobody is signed in, so the library sends the visit here. */
export const Page: Story = {
  render: () => <StoryApp path="/library" scenario="signed-out" />,
}

/**
 * The demo people, grouped by role with the domains of that role beside each person, the
 * administrator first. Choosing another person renames the button.
 */
export const DemoPeople: Story = {
  render: () => (
    <Frame>
      <SignInChoices people={people} onSignIn={noop} />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const picker = await canvas.findByRole('combobox', { name: 'Sign in as' })
    await expect(canvas.getByRole('button', { name: 'Continue as Ravi Kapoor' })).toBeEnabled()
    await userEvent.click(picker)
    const body = within(canvasElement.ownerDocument.body)
    const owners = await body.findByRole('group', { name: 'Owners' })
    await userEvent.click(within(owners).getByRole('option', { name: /Jon Abara/ }))
    await expect(canvas.getByRole('button', { name: 'Continue as Jon Abara' })).toBeVisible()
    await expect(picker).toHaveTextContent('Owner')
    await expect(picker).toHaveTextContent('Sales')
  },
}

const onKeyboardSignIn = fn()

/**
 * By keyboard alone: typing a name on the closed field chooses that person, and Enter signs in.
 * In the open list, typing moves to a person, Enter chooses them and closes the list, and a
 * second Enter signs in. Opening the list moves nothing on the page.
 */
export const KeyboardSignIn: Story = {
  render: () => (
    <Frame>
      <SignInChoices people={people} onSignIn={onKeyboardSignIn} />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const onSignIn = onKeyboardSignIn
    onSignIn.mockClear()
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const picker = await canvas.findByRole('combobox', { name: 'Sign in as' })
    picker.focus()
    await userEvent.keyboard('Jon')
    await expect(picker).toHaveTextContent('Jon Abara')
    await userEvent.keyboard('{Enter}')
    await expect(onSignIn).toHaveBeenLastCalledWith('per_jon@example.test')
    await expect(body.queryByRole('listbox')).toBeNull()

    const card = canvasElement.ownerDocument.querySelector('[data-slot="auth-card"]')!
    const closed = card.getBoundingClientRect().toJSON() as DOMRect
    await userEvent.keyboard('{ArrowDown}')
    await body.findByRole('listbox')
    await expect(card.getBoundingClientRect().toJSON()).toEqual(closed)
    await userEvent.keyboard('Ella')
    await waitFor(() =>
      expect(body.getByRole('option', { name: /Ella Voss/ })).toHaveAttribute('data-highlighted'),
    )
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(body.queryByRole('listbox')).toBeNull())
    await expect(picker).toHaveFocus()
    await expect(onSignIn).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Enter}')
    await expect(onSignIn).toHaveBeenLastCalledWith('per_ella@example.test')
  },
}

/** Thirty contributors more than fit: a long list, as a large demo install has. */
const many: SignInPerson[] = [
  ...people,
  ...Array.from({ length: 30 }, (_, index) => ({
    email: `per_reader_${index + 1}@example.test`,
    name: `Reader ${index + 1}`,
    initials: `R${(index + 1) % 10}`,
    roles: [],
    assignments: [],
  })),
]

/**
 * A list longer than the window: it ends 12 short of the window's edge, with an arrow that says
 * more is below, and scrolls inside, so the page never grows past the window. Try the phone too.
 */
export const LongList: Story = {
  render: () => (
    <Frame>
      <SignInChoices people={many} onSignIn={noop} />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const view = canvasElement.ownerDocument.defaultView!
    await userEvent.click(await canvas.findByRole('combobox', { name: 'Sign in as' }))
    const listbox = await body.findByRole('listbox')
    const popup = listbox.closest('[data-slot="select-content"]')!
    await waitFor(() =>
      expect(view.innerHeight - popup.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(11),
    )
    await expect(listbox.scrollHeight).toBeGreaterThan(listbox.clientHeight)
    await expect(canvasElement.ownerDocument.documentElement.scrollHeight).toBe(view.innerHeight)
  },
}

/** While the service answers: the button says so, and nothing can be changed. */
export const SigningIn: Story = {
  render: () => (
    <Frame>
      <SignInChoices people={people} pending onSignIn={noop} />
    </Frame>
  ),
}

/** The service refused (the person left the people file since the page loaded). */
export const SignInFailed: Story = {
  render: () => (
    <Frame>
      <SignInChoices
        people={people}
        error={new ApiError('signed-out', 'Unauthorized', { status: 401 })}
        onSignIn={noop}
      />
    </Frame>
  ),
}

/** Heed could not be reached at all. */
export const ServiceDown: Story = {
  render: () => (
    <Frame>
      <SignInChoices
        people={people}
        error={new ApiError('unavailable', 'No answer')}
        onSignIn={noop}
      />
    </Frame>
  ),
}

export const Loading: Story = {
  render: () => (
    <Frame>
      <SignInLoading />
    </Frame>
  ),
}

export const ListFailed: Story = {
  render: () => (
    <Frame>
      <SignInLoadFailed onRetry={noop} />
    </Frame>
  ),
}

/** No demo people and no company sign-in: nothing to choose, and who can fix it. */
export const NoOneToSignIn: Story = {
  render: () => (
    <Frame>
      <SignInChoices people={[]} onSignIn={noop} />
    </Frame>
  ),
}

/** Once company sign-in is configured: its button leads, the demo people follow quietly. */
export const WithCompanySignIn: Story = {
  render: () => (
    <Frame>
      <SignInChoices people={people} company={company} onSignIn={noop} />
    </Frame>
  ),
}

/** Production, once company sign-in exists: the company button alone. */
export const CompanyOnly: Story = {
  render: () => (
    <Frame>
      <SignInChoices people={[]} company={company} onSignIn={noop} />
    </Frame>
  ),
}

/** A long name and many domains wrap inside the picker and never widen the card. */
export const LongText: Story = {
  render: () => (
    <Frame>
      <SignInChoices
        people={[
          {
            email: 'long@example.test',
            name: 'Maximiliana Alexandra Fitzgerald-Montgomery Østergaard',
            initials: 'MØ',
            roles: ['administrator', 'auditor'],
            assignments: [
              { role: 'owner', area: sales },
              { role: 'owner', area: marketing },
              { role: 'approver', area: sandbox },
            ],
          },
          ...people,
        ]}
        onSignIn={noop}
      />
    </Frame>
  ),
}
