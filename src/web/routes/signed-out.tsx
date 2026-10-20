import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AuthPage } from '@/components/sign-in/auth-page'
import { SignInIntro, SignInMethods } from '@/components/sign-in/sign-in-form'
import { validateSignedOutSearch } from '@/lib/search-params'

/**
 * The sign-in page. Any request that answers "nobody is signed in" (401) leads here, instead of
 * an empty or failed list, and so does Sign out. It stands outside the shell: nothing on it needs
 * a session. Signing in replaces whatever was cached for the last person and goes back to the
 * page the person was on.
 */
export const Route = createFileRoute('/signed-out')({
  validateSearch: validateSignedOutSearch,
  component: SignInPage,
})

function SignInPage() {
  const { from } = Route.useSearch()
  const navigate = useNavigate()
  const target = from && !from.startsWith('/signed-out') ? from : '/'
  return (
    <AuthPage title="Sign in" heading="paper">
      <SignInIntro />
      <SignInMethods onSignedIn={() => void navigate({ href: target, replace: true })} />
    </AuthPage>
  )
}
