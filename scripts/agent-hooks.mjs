import { spawnSync } from 'node:child_process'
import { accessSync, constants, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const git = (...args) => {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function installed(event) {
  const name = `hook.hk-${event}`
  const command = git('config', '--get', `${name}.command`)
  const events = git('config', '--get-all', `${name}.event`).split('\n')
  const enabled = git('config', '--type=bool', '--get', `${name}.enabled`)
  const expected = `test "\${HK:-1}" = "0" || mise x -- hk run ${event} --from-hook`
  if (events.includes(event) && enabled !== 'false' && command === expected) return true
  const path = resolve(git('rev-parse', '--git-path', `hooks/${event}`))
  try {
    accessSync(path, constants.X_OK)
    const text = readFileSync(path, 'utf8')
    return (
      text.replaceAll('\r\n', '\n').trim() ===
      `#!/bin/sh\ntest "\${HK:-1}" = "0" || exec mise x -- hk run ${event} --from-hook "$@"`
    )
  } catch {
    return false
  }
}

const required = ['pre-commit', 'commit-msg', 'pre-push']
if (process.env.HK === '0' || !required.every(installed)) {
  console.error('Git hooks are missing or inactive. Run: mise run hooks:install')
  process.exitCode = 1
}
