import { defineManifest } from '../../domain/define-manifest.ts'

/**
 * Google Docs in Google Drive (CON-601, CON-611): the folders shared with a service account, which
 * an admin chooses and maps to domains, become suggestions for the owners of each folder's domain,
 * one per document. The account can only view what is shared with it; a read signs in with its
 * key, exports each document as Markdown and reads the changes since the last read. A read never
 * publishes: an owner does.
 */
export const manifest = defineManifest({
  id: 'google-drive',
  version: '1.0.0',
  heed: '^3.0',
  kind: 'content',
  tool: 'Google Drive',
  title: 'Google Drive',
  summary: 'Google Docs in folders you share become suggestions for owners.',
  icon: 'file',
  docs: './README.md',
  maintainer: { name: 'Core team' },
  support: 'core',
  maturity: 'beta',
  config: {
    fields: [
      {
        key: 'apiAddress',
        kind: 'address',
        label: 'Google API address',
        description:
          'Where Drive is reached. Leave it empty for Google’s own address. Change it only when your company reaches Google through an endpoint of its own.',
        placeholder: 'https://www.googleapis.com',
        advanced: true,
      },
      {
        key: 'signInAddress',
        kind: 'address',
        label: 'Google sign-in address',
        description:
          'Where the service account signs in. Leave it empty for Google’s own address. Change it only when your company reaches Google through an endpoint of its own.',
        placeholder: 'https://oauth2.googleapis.com/token',
        advanced: true,
      },
    ],
  },
  secrets: [
    {
      key: 'serviceAccountKey',
      label: 'Service account key',
      description:
        'The JSON key of a service account, created in your Google Cloud project. It is kept where only this source can use it, and only to read.',
      required: true,
      boundTo: ['apiAddress', 'signInAddress'],
    },
  ],
  access: [
    'View access to the folders you share with its service account. It cannot see the rest of your Drive, and nothing is ever written to it.',
    'Who may read a document is not copied: once an owner publishes a suggestion, everyone in the workspace reads it.',
  ],
  egress: {
    hosts: [
      { host: 'www.googleapis.com' },
      { host: 'oauth2.googleapis.com', signIn: true },
      { fromField: 'apiAddress' },
      { fromField: 'signInAddress', signIn: true },
    ],
  },
  capabilities: {
    discover: 'folders',
    incremental: true,
    deletions: 'both',
    domain: 'per-scope',
    links: false,
  },
  schedule: { default: 'P1D', minimum: 'PT15M' },
  staleAfter: 'P2D',
  limits: { timeoutSeconds: 600, maxRecords: 5000, draftsPerDay: 20 },
  warnings: {
    api_disabled: {
      level: 'warning',
      title: 'The Google Drive API is off',
      detail:
        'Switch the Google Drive API on in the Google Cloud project of the service account, then read again.',
    },
  },
  markVersion: 1,
})
