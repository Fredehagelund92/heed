import type { Meta, StoryObj } from '@storybook/react-vite'
import { catalogueStatuses, catalogueTermKinds } from '@domain/catalogue'
import {
  CatalogueStatusBadge,
  TermDomainBadge,
  TermTile,
} from '@/components/catalogue/catalogue-marks'
import { StoryApp } from './story-app'

/**
 * The catalogue (FR-136, design contract 5) in the real shell, in its two orders, two densities
 * and every state of contract 9.5. Use the viewport menu for 1440, 1024 and 390 and the theme
 * menu for dark.
 */
const meta = {
  title: 'Catalogue/Catalogue page',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const fresh = { 'cl.catalogue.density': 'description' }

export const GroupedByDomain: Story = {
  render: () => <StoryApp path="/catalogue" preferences={fresh} />,
}

export const AToZ: Story = {
  render: () => <StoryApp path="/catalogue?order=az" preferences={fresh} />,
}

export const Compact: Story = {
  render: () => <StoryApp path="/catalogue" preferences={{ 'cl.catalogue.density': 'compact' }} />,
}

export const Metrics: Story = {
  render: () => <StoryApp path="/catalogue?kind=metric" preferences={fresh} />,
}

export const Dimensions: Story = {
  render: () => <StoryApp path="/catalogue?kind=dimension" preferences={fresh} />,
}

export const SearchWithMarks: Story = {
  render: () => <StoryApp path="/catalogue?q=order" preferences={fresh} />,
}

export const FiltersOn: Story = {
  render: () => (
    <StoryApp
      path="/catalogue?status=active_issues,changed&area=area_customer_value"
      preferences={fresh}
    />
  ),
}

export const NoResults: Story = {
  render: () => <StoryApp path="/catalogue?q=zzzz&status=gone" preferences={fresh} />,
}

export const Loading: Story = {
  render: () => <StoryApp path="/catalogue" scenario="slow" preferences={fresh} />,
}

export const Empty: Story = {
  render: () => <StoryApp path="/catalogue" scenario="no-terms" preferences={fresh} />,
}

export const Error: Story = {
  render: () => <StoryApp path="/catalogue" scenario="error" preferences={fresh} />,
}

/** Cube could not be read: the copies are the last ones, and the line says how old (CON-213). */
export const SourceDown: Story = {
  render: () => <StoryApp path="/catalogue" scenario="source-down" preferences={fresh} />,
}

export const Phone: Story = {
  render: () => <StoryApp path="/catalogue" preferences={fresh} />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

export const PhoneAToZ: Story = {
  render: () => <StoryApp path="/catalogue?order=az" preferences={fresh} />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

/** A dimension's page until slice S4 builds it. */
export const DimensionPlaceholder: Story = {
  render: () => <StoryApp path="/catalogue/dimension/market" />,
}

/** The marks of a catalogue row: the quiet type tile, every status, and the domain forms. */
export const Marks: StoryObj = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        {catalogueTermKinds.map((kind) => (
          <div key={kind} className="flex items-center gap-2">
            <TermTile kind={kind} />
            <TermTile kind={kind} size="md" />
          </div>
        ))}
      </div>
      {(['md', 'sm'] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-4">
          {catalogueStatuses.map((status) => (
            <CatalogueStatusBadge
              key={status}
              status={status}
              activeIssues={3}
              tool="Cube"
              size={size}
            />
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-4">
        <TermDomainBadge name="Sales" label="teal" none={null} />
        <TermDomainBadge name="All domains" label={null} none="dimension" />
        <TermDomainBadge name="No domain" label={null} none="metric" />
        <TermDomainBadge name="Sales" label="teal" none={null} form="bare" />
        <TermDomainBadge name="All domains" label={null} none="dimension" form="bare" />
        <TermDomainBadge name="Unknown domain" label={null} none={null} />
      </div>
    </div>
  ),
}
