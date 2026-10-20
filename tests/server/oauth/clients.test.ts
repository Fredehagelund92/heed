import { describe, expect, it } from 'vitest'
import {
  fetchMetadataDocument,
  isPublicAddress,
  metadataDocumentProblem,
  readClientMetadata,
  redirectMatches,
  redirectProblem,
} from '../../../src/server/modules/oauth/index.ts'

describe('redirect addresses', () => {
  it('takes https anywhere and http on this computer only', () => {
    for (const ok of [
      'https://claude.ai/api/mcp/auth_callback',
      'https://app.example/cb?tenant=1',
      'http://127.0.0.1:33418/',
      'http://localhost:8080/callback',
      'http://[::1]:9000/cb',
    ])
      expect(redirectProblem(ok), ok).toBeNull()
    for (const bad of [
      'http://app.example/cb',
      'http://127.0.0.2/cb',
      'http://localhost.evil.example/cb',
      'https://*.example.com/cb',
      'https://app.example/*',
      'https://app.example/cb#x',
      'https://user:secret@app.example/cb',
      'myapp://callback',
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      '/cb',
      'https://app.example/' + 'a'.repeat(600),
    ])
      expect(redirectProblem(bad), bad).not.toBeNull()
  })

  it('matches exactly, except that a loopback address may change its port', () => {
    const registered = ['http://127.0.0.1:4000/callback', 'https://app.example/cb']
    expect(redirectMatches(registered, 'https://app.example/cb')).toBe(true)
    expect(redirectMatches(registered, 'http://127.0.0.1:4000/callback')).toBe(true)
    expect(redirectMatches(registered, 'http://127.0.0.1:59999/callback')).toBe(true)
    expect(redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:59999/callback')).toBe(
      true,
    )
    for (const other of [
      'https://app.example/cb/',
      'https://app.example/cb?x=1',
      'https://app.example:444/cb',
      'https://APP.example/cb2',
      'http://127.0.0.1:4000/callback?x=1',
      'http://127.0.0.1:4000/other',
      'http://localhost:4000/callback',
      'https://127.0.0.1:4000/callback',
      'http://127.0.0.1:4000/callback#f',
    ])
      expect(redirectMatches(registered, other), other).toBe(false)
  })
})

describe('client metadata', () => {
  const document = 'https://app.example/client.json'
  it('reads a name and redirect addresses, and names a client without a name by its host', () => {
    expect(
      readClientMetadata({ client_name: ' My app ', redirect_uris: ['https://app.example/cb'] }),
    ).toEqual({ metadata: { name: 'My app', redirectUris: ['https://app.example/cb'] } })
    expect(readClientMetadata({ redirect_uris: ['http://127.0.0.1:5000/cb'] })).toEqual({
      metadata: { name: '127.0.0.1', redirectUris: ['http://127.0.0.1:5000/cb'] },
    })
    expect(
      readClientMetadata(
        { client_id: document, redirect_uris: ['https://app.example/cb'] },
        { metadataDocument: document },
      ),
    ).toEqual({ metadata: { name: 'app.example', redirectUris: ['https://app.example/cb'] } })
  })

  it('refuses what a public client with the code flow cannot be', () => {
    for (const bad of [
      null,
      [],
      'text',
      { redirect_uris: [] },
      { redirect_uris: 'https://app.example/cb' },
      { redirect_uris: ['http://app.example/cb'] },
      { redirect_uris: ['https://app.example/cb'], grant_types: ['implicit'] },
      { redirect_uris: ['https://app.example/cb'], grant_types: ['refresh_token'] },
      { redirect_uris: ['https://app.example/cb'], response_types: ['code', 'token'] },
      { redirect_uris: ['https://app.example/cb'], client_name: 'a\u0000b' },
      { redirect_uris: ['https://app.example/cb'], client_name: 'evil‮txt.exe' },
      { redirect_uris: ['https://app.example/cb'], client_name: 7 },
    ])
      expect(readClientMetadata(bad), JSON.stringify(bad)).toHaveProperty('problem')
    expect(
      readClientMetadata(
        { client_id: 'https://other.example/c.json', redirect_uris: ['https://app.example/cb'] },
        { metadataDocument: document },
      ),
    ).toHaveProperty('problem')
    expect(
      readClientMetadata(
        {
          client_id: document,
          redirect_uris: ['https://app.example/cb'],
          token_endpoint_auth_method: 'private_key_jwt',
        },
        { metadataDocument: document },
      ),
    ).toHaveProperty('problem')
  })

  it('accepts only plain https document addresses with a path', () => {
    expect(metadataDocumentProblem(document)).toBeNull()
    for (const bad of [
      'https://app.example',
      'https://app.example/',
      'http://app.example/client.json',
      'https://app.example/client.json?v=1',
      'https://app.example/client.json#x',
      'https://u:p@app.example/client.json',
      'https://app.example/a/../client.json',
      'https://app.example/./client.json',
      'https://app.example/' + 'a'.repeat(600),
    ])
      expect(metadataDocumentProblem(bad), bad).not.toBeNull()
  })
})

describe('reading a metadata document never reaches the inside of the network', () => {
  it('knows which addresses are public', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
      expect(isPublicAddress(address), address).toBe(true)
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      'fc00::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
      'not an address',
    ])
      expect(isPublicAddress(address), address).toBe(false)
  })

  it('refuses an address on this computer or a private network before connecting', async () => {
    for (const address of [
      'https://127.0.0.1/client.json',
      'https://[::1]/client.json',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.1/client.json',
    ])
      await expect(fetchMetadataDocument(address), address).rejects.toThrow('not public')
  })

  it('refuses a name that resolves to this computer', async () => {
    await expect(fetchMetadataDocument('https://localhost/client.json')).rejects.toThrow()
  })
})
