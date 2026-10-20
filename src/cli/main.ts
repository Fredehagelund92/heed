/** Entry point of `heed` (`npm run heed -- <command>`); src/cli/commands.ts has the commands. */
import { run } from './commands.ts'

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
})
