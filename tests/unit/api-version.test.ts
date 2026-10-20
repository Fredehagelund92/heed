import { afterEach, describe, expect, it } from 'vitest'
import {
  noteServiceVersion,
  outdatedSide,
  resetOutdated,
  subscribeOutdated,
  updateAdvice,
} from '@/api/api-version'

/*
  Telling an update that one side has not caught up with: the app was built for one contract and
  the service names another. The web server's own build says which side is old.
*/

afterEach(resetOutdated)
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the contract the service names', () => {
  it('is the page that is old when the web server serves a build of the service contract', async () => {
    noteServiceVersion('new', 'old', () => Promise.resolve('new'))
    expect(outdatedSide()).toBe('checking')
    await settled()
    expect(outdatedSide()).toBe('page')
  })

  it('is the service that is old when the web server serves the app build, or says nothing', async () => {
    noteServiceVersion('old', 'new', () => Promise.resolve('new'))
    await settled()
    expect(outdatedSide()).toBe('service')
    resetOutdated()
    noteServiceVersion('old', 'new', () => Promise.resolve(null))
    await settled()
    expect(outdatedSide()).toBe('service')
  })

  it('checks once, and clears when the service names the app contract again', async () => {
    let reads = 0
    const read = () => {
      reads++
      return Promise.resolve('build')
    }
    const changes: (string | null)[] = []
    const stop = subscribeOutdated(() => changes.push(outdatedSide()))
    noteServiceVersion('old', 'own', read)
    noteServiceVersion('old', 'own', read)
    await settled()
    expect(reads).toBe(1)
    noteServiceVersion('own', 'own', read)
    expect(outdatedSide()).toBeNull()
    stop()
    expect(changes).toEqual(['checking', 'service', null])
  })

  it('says nothing for an answer that names no contract, as from a service of before', () => {
    noteServiceVersion(null, 'own', () => Promise.resolve('x'))
    expect(outdatedSide()).toBeNull()
  })
})

describe('the advice', () => {
  it('says to reload a page, and to wait for a service that is starting again', () => {
    expect(updateAdvice('page')).toBe(
      'The app was updated. Reload the page to use the new version.',
    )
    expect(updateAdvice('service')).toBe(
      'The app was updated and is still starting. Try again in a few minutes.',
    )
  })
})
