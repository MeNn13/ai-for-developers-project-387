import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('readiness rejects formatting and an unregistered entry, then accepts repairs', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-ready-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const write = (name, value) => writeFileSync(join(directory, name), value)
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'junction')
  const initialized = spawnSync('git', ['init'], { cwd: directory, encoding: 'utf8' })
  assert.equal(initialized.status, 0, initialized.stderr)
  copyFileSync(join(root, 'mise.toml'), join(directory, 'mise.toml'))
  mkdirSync(join(directory, 'scripts'))
  copyFileSync(join(root, 'scripts/agent-hooks.mjs'), join(directory, 'scripts/agent-hooks.mjs'))
  copyFileSync(
    join(root, 'scripts/test-git-environment.mjs'),
    join(directory, 'scripts/test-git-environment.mjs'),
  )
  copyFileSync(join(root, 'hk.pkl'), join(directory, 'hk.pkl'))
  write('.prettierrc.json', readFileSync(join(root, '.prettierrc.json')))
  write(
    'package.json',
    JSON.stringify({
      private: true,
      scripts: {
        'format:check': `node "${join(root, 'node_modules/prettier/bin/prettier.cjs')}" --check .`,
        knip: `node "${join(root, 'node_modules/knip/bin/knip.js')}"`,
      },
    }),
  )
  const run = (...args) =>
    spawnSync(process.env.MISE_TEST_BIN, args, {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        MISE_TRUSTED_CONFIG_PATHS: directory,
        npm_config_offline: 'true',
        npm_config_yes: 'false',
      },
    })
  // Format the fixture's configuration with the real formatter first.
  const formatted = spawnSync(
    process.execPath,
    [join(root, 'node_modules/prettier/bin/prettier.cjs'), '--write', '.'],
    { cwd: directory, encoding: 'utf8' },
  )
  assert.equal(formatted.status, 0, formatted.stdout + formatted.stderr)
  write('entry.mjs', 'console.log(  "ready" )\n')
  let result = run('run', 'agent:ready')
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /entry.mjs/)
  result = run('exec', '--', 'hk', 'run', 'pre-commit', '--step', 'prettier', 'entry.mjs')
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /entry.mjs/)
  write('entry.mjs', "console.log('ready')\n")
  result = run('run', 'agent:ready')
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /Unused files[\s\S]*entry.mjs/)
  write('knip.json', '{ "entry": ["entry.mjs"] }\n')
  spawnSync(
    process.execPath,
    [join(root, 'node_modules/prettier/bin/prettier.cjs'), '--write', 'knip.json'],
    { cwd: directory },
  )
  result = run('run', 'agent:ready')
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /mise run hooks:install/)
  result = run('run', 'hooks:install')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  result = run('run', 'agent:ready')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  result = run('exec', '--', 'hk', 'run', 'pre-commit', '--step', 'prettier', 'entry.mjs')
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
