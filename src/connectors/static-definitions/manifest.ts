import { defineManifest } from '../../domain/define-manifest.ts'

/**
 * A static list of definitions: metrics and dimensions an admin writes in the form, as JSON.
 * The smallest definitions connector there is, with no host and no secret, so it proves the
 * whole path of interface 3.0 (manifest, form, check, read, the definitions pipeline) on its
 * own. Useful for a trial, or for a team without a semantic layer yet.
 */
export const manifest = defineManifest({
  id: 'static-definitions',
  version: '1.0.0',
  heed: '^3.0',
  kind: 'definitions',
  tool: 'Static list',
  title: 'Static list of definitions',
  summary:
    'Metrics and dimensions you write in this form, as JSON. For a trial, or for a team without a semantic layer yet.',
  icon: 'list',
  docs: './README.md',
  maintainer: { name: 'Core team' },
  support: 'core',
  maturity: 'experimental',
  refPrefix: 'static',
  config: {
    fields: [
      {
        key: 'definitions',
        kind: 'json',
        label: 'Definitions',
        description:
          'A JSON list. Each entry has a kind (metric or dimension) and a name, and may have a title, a description, a type and a domain.',
        required: true,
        placeholder:
          '[\n  { "kind": "metric", "name": "payments.orders", "title": "Orders", "domain": "commercial" },\n  { "kind": "dimension", "name": "payments.market", "title": "Market" }\n]',
        maxLength: 20_000,
      },
      {
        key: 'domainNames',
        kind: 'domain_map',
        label: 'Domain names',
        description:
          'Where an entry names its domain differently from your domains, the domain it means. A domain id needs no line.',
        advanced: true,
      },
    ],
  },
  secrets: [],
  access: ['Nothing outside this app: it reads only the list you write in this form.'],
  egress: { hosts: [] },
  capabilities: {
    discover: false,
    incremental: false,
    deletions: 'full-listing',
    domain: 'hint',
    marks: 'meaning',
  },
  schedule: { default: 'PT1H', minimum: 'PT1H' },
  staleAfter: 'PT6H',
  limits: { timeoutSeconds: 10, maxRecords: 500 },
  warnings: {
    unreadable_list: {
      level: 'warning',
      title: 'The list could not be read',
      detail: 'The definitions are not a list this connector reads. Change the settings to fix it.',
    },
    description_cut: {
      level: 'info',
      title: 'A description was cut',
      detail: 'Only the first 500 characters of a description are kept, as a copy.',
    },
  },
  markVersion: 1,
})
