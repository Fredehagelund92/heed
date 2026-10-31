import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { invalidateAfter } from '@/api/queries'

describe('signing in as someone else', () => {
  it("keeps the last person's late read out of the cache and the sign-in page's own read in", async () => {
    const queryClient = new QueryClient()

    let finish: (data: string) => void = () => {}
    const lastPersonsRead = new Promise<string>((resolve) => {
      finish = resolve
    })
    const inbox = ['getInbox', 'feed']
    queryClient.fetchQuery({ queryKey: inbox, queryFn: () => lastPersonsRead }).catch(() => {})

    const people = ['listSignInPeople']
    const signInPage = new QueryObserver(queryClient, {
      queryKey: people,
      queryFn: () => Promise.resolve(['Ravi']),
    })
    const stop = signInPage.subscribe(() => {})
    await queryClient.fetchQuery({ queryKey: people, queryFn: () => Promise.resolve(['Ravi']) })

    await invalidateAfter(queryClient, 'signIn', {} as never, {} as never)
    finish("the last person's inbox")
    await lastPersonsRead
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(queryClient.getQueryData(inbox)).toBeUndefined()
    expect(queryClient.getQueryData(people)).toEqual(['Ravi'])
    stop()
  })
})
