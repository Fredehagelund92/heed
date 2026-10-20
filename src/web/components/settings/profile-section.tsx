import { MonitorIcon, MoonIcon, SunIcon } from '@/components/icons'
import { PageContent } from '@/components/page/page'
import { PersonAvatar } from '@/components/person-avatar'
import {
  Field,
  FieldDescription,
  FieldItem,
  FieldItemContent,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { appearances, setAppearance, useAppearance, type Appearance } from '@/lib/appearance'
import { usePermissions, useSession } from '@/lib/use-session'
import { SettingsBlock } from './settings-parts'

const appearanceWords: Record<Appearance, { label: string; description: string }> = {
  light: { label: 'Light', description: 'Dark text on a light page.' },
  dark: { label: 'Dark', description: 'Light text on a dark page.' },
  system: {
    label: 'Like this device',
    description: 'Follows the setting of your computer or phone.',
  },
}
const appearanceIcons = { light: SunIcon, dark: MoonIcon, system: MonitorIcon }

/**
 * A person's profile and appearance, for everyone: who they are to Heed and what they may do, and
 * how the app looks on this device. Names and roles come from the company directory and
 * administrators, so they are read here, not changed. The AI apps connected as them are in
 * Connect your AI, the other section of their Settings.
 */
export function ProfileSection() {
  const { data: session } = useSession()
  const { roleLines } = usePermissions()
  const appearance = useAppearance()
  const person = session?.person

  return (
    <PageContent width="reading" className="gap-8" data-slot="settings-profile">
      <SettingsBlock
        title="You"
        description="Your name comes from the company sign-in. Admins give the roles, so ask one if a role is missing."
      >
        {person ? (
          <div className="flex items-center gap-3 rounded-lg border p-4">
            <PersonAvatar person={person} size="lg" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="truncate text-body font-bold">{person.name}</p>
              <ul
                aria-label="Your roles"
                className="flex flex-col text-dense text-muted-foreground"
              >
                {roleLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <Skeleton role="status" aria-label="Loading your profile" className="h-16 w-full" />
        )}
      </SettingsBlock>

      <SettingsBlock title="Appearance" description="Kept in this browser only.">
        <Field name="appearance">
          <FieldSet
            render={
              <RadioGroup
                value={appearance}
                onValueChange={(next: Appearance) => setAppearance(next)}
              />
            }
          >
            <FieldLegend className="sr-only">Appearance</FieldLegend>
            {appearances.map((mode) => {
              const Glyph = appearanceIcons[mode]
              return (
                <FieldItem key={mode}>
                  <RadioGroupItem value={mode} />
                  <FieldItemContent>
                    <FieldLabel icon={Glyph}>{appearanceWords[mode].label}</FieldLabel>
                    <FieldDescription>{appearanceWords[mode].description}</FieldDescription>
                  </FieldItemContent>
                </FieldItem>
              )
            })}
          </FieldSet>
        </Field>
      </SettingsBlock>
    </PageContent>
  )
}
