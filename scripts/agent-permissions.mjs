import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'
import { shells, permissionCases as cases } from './agent-policy-cases.mjs'

const userDirectory = join(homedir(), '.codex/rules')
const codex = join(homedir(), 'AppData/Local/Programs/OpenAI/Codex/bin/codex.exe')
if (process.platform !== 'win32' || !existsSync(codex)) {
  throw new Error('Run this local policy diagnostic on Windows with the Codex CLI installed.')
}
const ruleArguments = readdirSync(userDirectory)
  .filter((file) => file.endsWith('.rules'))
  .flatMap((file) => ['--rules', join(userDirectory, file)])
let failures = 0
for (const shell of shells) {
  for (const [command, allowed] of cases) {
    const result = spawnSync(
      codex,
      ['execpolicy', 'check', ...ruleArguments, '--', shell, '-Command', command],
      { encoding: 'utf8' },
    )
    if (result.status !== 0) throw new Error(result.stderr || 'Codex policy check failed')
    const decision = JSON.parse(result.stdout).decision ?? 'unmatched'
    const passed = (decision === 'allow') === allowed
    if (!passed) failures++
    console.log(`${passed ? 'PASS' : 'FAIL'} ${win32.basename(shell)}: ${command} (${decision})`)
  }
}
console.log(`${cases.length * shells.length} policy checks; ${failures} failures`)
console.log(
  'This checks rule matching, not sandbox access or rules loaded by an already running session.',
)
process.exitCode = failures ? 1 : 0
