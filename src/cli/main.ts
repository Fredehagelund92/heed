/** Entry point of `heed` (`npm run heed -- <command>`); src/cli/commands.ts has the commands. */
import { renamedSettingsWarning, withRenamedSettings } from '../domain/renamed-settings.ts'
import { run } from './commands.ts'

// A setting under its old CL_ name still counts, with one warning (src/domain/renamed-settings.ts).
const { environment, oldNames } = withRenamedSettings(process.env)
if (oldNames.length) process.stderr.write(`${renamedSettingsWarning(oldNames)}\n`)

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: environment,
})
