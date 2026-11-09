import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const gitCommands = new Set([
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'symbolic-ref',
  'check-ref-format',
  'for-each-ref',
  'fetch',
  'add',
  'commit',
])
const issueCommands = new Set(['view', 'list', 'status', 'create', 'edit', 'close', 'reopen'])
const prCommands = new Set(['view', 'list', 'status', 'diff', 'checks', 'create', 'edit', 'ready'])

export function isAllowed(command) {
  if (!Array.isArray(command) || !command.every((arg) => typeof arg === 'string')) return false
  const [program, operation, action] = command
  if (program === 'git') {
    if (gitCommands.has(operation)) return true
    return (
      command.length === 4 &&
      !command[3].startsWith('-') &&
      ((operation === 'switch' && action === '-c') || (operation === 'checkout' && action === '-b'))
    )
  }
  if (program !== 'gh') return false
  return (
    (operation === 'issue' && issueCommands.has(action)) ||
    (operation === 'pr' && prCommands.has(action)) ||
    (operation === 'repo' && action === 'view')
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/agent-command.mjs')
  const command = JSON.parse(
    readFileSync('artifacts/agent-command.json', 'utf8').replace(/^\uFEFF/, ''),
  )
  if (!isAllowed(command)) throw new Error('Command requires separate approval')
  // No shell: JSON arguments are passed literally, including quotes and metacharacters.
  execFileSync(command[0], command.slice(1), { stdio: 'inherit' })
}
