import { createFileRoute, Link } from '@tanstack/react-router'
import {
  DEFAULT_MOCK_PERSON,
  MOCK_PERSON_KEY,
  MOCK_SCENARIO_KEY,
  type MockScenario,
} from '@/api/mock-scenario'
import { Page, PageContent } from '@/components/page/page'
import { Button } from '@/components/ui/button'
import { pageTemplates } from '@/design-preview/catalog'

const scenarios: { id: MockScenario | null; title: string; description: string }[] = [
  { id: null, title: 'Normal', description: 'The 1,500 fixture items.' },
  { id: 'empty', title: 'First run', description: 'No items yet: the welcome page.' },
  { id: 'few', title: 'Nearly empty', description: 'Six items: the welcome and the list.' },
  {
    id: 'quiet',
    title: 'Quiet',
    description: 'Nothing changed lately and no known data issue: the empty tabs on Home.',
  },
  { id: 'slow', title: 'Slow', description: 'Every request takes 2.5 seconds: loading states.' },
  { id: 'error', title: 'Failed', description: 'The library request fails: the error state.' },
  {
    id: 'refresh-fails',
    title: 'Refresh fails',
    description: 'The first load works and every refresh fails: the stale banner after a refresh.',
  },
  {
    id: 'signed-out',
    title: 'Signed out',
    description: 'Every request answers that nobody is signed in: the signed-out page.',
  },
]

/** People the mock can sign in as, one per role. */
const mockPeople = [
  { id: DEFAULT_MOCK_PERSON, title: 'Maria', description: 'A contributor.' },
  { id: 'per_jon', title: 'Jon', description: 'Owner of Sales and Sandbox.' },
  { id: 'per_sofia', title: 'Sofia', description: 'Deputy of Sales.' },
  { id: 'per_lars', title: 'Lars', description: 'High-risk approver of Sales.' },
  { id: 'per_ravi', title: 'Ravi', description: 'An administrator.' },
]

/** Signs the mock in as another person and reloads, so every cached answer is theirs. */
function signInAs(id: string) {
  try {
    if (id === DEFAULT_MOCK_PERSON) window.localStorage.removeItem(MOCK_PERSON_KEY)
    else window.localStorage.setItem(MOCK_PERSON_KEY, id)
  } catch {
    // Storage blocked: the mock stays signed in as Maria.
  }
  window.location.reload()
}

/** Switches the mock API to a scenario and opens the library in it (a full reload, on purpose). */
function openScenario(id: MockScenario | null) {
  try {
    if (id) window.localStorage.setItem(MOCK_SCENARIO_KEY, id)
    else window.localStorage.removeItem(MOCK_SCENARIO_KEY)
  } catch {
    // Storage blocked: the library opens in the normal scenario.
  }
  window.location.assign('/library')
}

export const Route = createFileRoute('/design-preview/')({
  component: DesignPreviewIndex,
})

function DesignPreviewIndex() {
  return (
    <Page title="Design preview">
      <PageContent width="reading">
        <p className="text-muted-foreground">
          One screenshot target per page template, plus the tokens. Used by the screenshot tests and
          for review while the design contract settles.
        </p>
        <ul className="flex flex-col gap-3">
          {pageTemplates.map((template) => (
            <li key={template.id}>
              <Link
                to="/design-preview/$template"
                params={{ template: template.id }}
                className="font-bold underline-offset-4 hover:underline"
              >
                {template.title}
              </Link>
              <p className="text-muted-foreground">{template.description}</p>
            </li>
          ))}
          <li>
            <Link
              to="/design-preview/$template"
              params={{ template: 'tokens' }}
              className="font-bold underline-offset-4 hover:underline"
            >
              Tokens
            </Link>
            <p className="text-muted-foreground">
              Colour, spacing, radius and type, drawn from tokens.css.
            </p>
          </li>
          <li>
            <Link
              to="/design-preview/$template"
              params={{ template: 'inputs' }}
              className="font-bold underline-offset-4 hover:underline"
            >
              Inputs
            </Link>
            <p className="text-muted-foreground">
              Where it applies, What happened with @ mentions, and mention tokens in Markdown.
            </p>
          </li>
          <li>
            <Link
              to="/design-preview/$template"
              params={{ template: 'proposal-parts' }}
              className="font-bold underline-offset-4 hover:underline"
            >
              Proposal parts
            </Link>
            <p className="text-muted-foreground">
              The status badges, checks, timeline, agent preview, overlaps, edition label and person
              chips, composed and in every state.
            </p>
          </li>
        </ul>
        <section className="flex flex-col gap-3">
          <h2 className="text-large font-bold tracking-large">Library scenarios</h2>
          <p className="text-muted-foreground">
            The mock API can play the states of the library. The choice stays until you pick Normal
            again.
          </p>
          <ul className="flex flex-col gap-3">
            {scenarios.map((scenario) => (
              <li key={scenario.title} className="flex items-center gap-3">
                <Button variant="outline" onClick={() => openScenario(scenario.id)}>
                  {scenario.title}
                </Button>
                <span className="text-muted-foreground">{scenario.description}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-large font-bold tracking-large">Signed in as</h2>
          <p className="text-muted-foreground">
            The mock API signs in one person. The user menu shows their role, and what they may do
            follows it. The choice stays until you pick Maria again.
          </p>
          <ul className="flex flex-col gap-3">
            {mockPeople.map((person) => (
              <li key={person.id} className="flex items-center gap-3">
                <Button variant="outline" onClick={() => signInAs(person.id)}>
                  {person.title}
                </Button>
                <span className="text-muted-foreground">{person.description}</span>
              </li>
            ))}
          </ul>
        </section>
      </PageContent>
    </Page>
  )
}
