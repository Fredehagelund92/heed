import * as React from 'react'
import { ChevronRightIcon } from '@/components/icons'
import { PersonAvatar } from '@/components/heed/bits'
import { Logo } from '@/components/heed/logo'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { person, signInPeople } from '@/data/world'
import { navigate } from '@/lib/router'
import { useStore } from '@/lib/store'
import { PRODUCT } from '@/lib/brand'

// Sign-in as the login-03 block lays it out: the demo person picker. Company sign-in is outside v1's
// route and comes before Heed ships to a team.
export function SignInPage() {
  const { dispatch } = useStore()
  const [fresh, setFresh] = React.useState(false)
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Logo className="h-8 self-center" />
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign in to {PRODUCT}</CardTitle>
            <CardDescription>This is a demo. Pick who you are.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <ItemGroup className="gap-2">
                {signInPeople.map((name) => {
                  const p = person(name)
                  return (
                    <div role="listitem" key={name}>
                      <Item
                        variant="outline"
                        size="sm"
                        render={
                          <button
                            type="button"
                            onClick={() => {
                              dispatch({ type: 'signIn', name, fresh })
                              navigate('/inbox')
                            }}
                          />
                        }
                        className="w-full text-left hover:bg-muted"
                      >
                        <ItemMedia>
                          <PersonAvatar name={name} />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{name}</ItemTitle>
                          <ItemDescription>{p.role}</ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                        </ItemActions>
                      </Item>
                    </div>
                  )
                })}
              </ItemGroup>
              <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                Or
              </FieldSeparator>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="fresh">Start as a new install</FieldLabel>
                  <FieldDescription>
                    A workspace with no context yet, and the setup checklist in the Inbox.
                  </FieldDescription>
                </FieldContent>
                <Switch id="fresh" checked={fresh} onCheckedChange={setFresh} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <p className="px-6 text-center text-xs text-balance text-muted-foreground">
          Larchwood Outdoor is an invented company. Every name, fact and number here is mock data.
        </p>
      </div>
    </main>
  )
}
