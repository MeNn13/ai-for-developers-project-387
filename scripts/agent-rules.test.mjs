import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { shells, permissionCases } from './agent-policy-cases.mjs'

const root = resolve(import.meta.dirname, '..')
const codex = resolve(homedir(), 'AppData/Local/Programs/OpenAI/Codex/bin/codex.exe')

test(
  'generated rules allow routine Windows commands and keep arbitrary scripts unapproved',
  {
    skip: !existsSync(codex) && 'requires the installed Windows Codex policy checker',
  },
  () => {
    const directory = resolve(root, 'artifacts/agent-rules-test')
    mkdirSync(directory, { recursive: true })
    const rules = resolve(directory, 'workflow.rules')
    const generated = spawnSync(process.execPath, ['scripts/agent-rules.mjs', '--output', rules], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(generated.status, 0, generated.stdout + generated.stderr)
    for (const shell of shells) {
      for (const [command, allowed] of permissionCases) {
        const result = spawnSync(
          codex,
          ['execpolicy', 'check', '--rules', rules, '--', shell, '-Command', command],
          { encoding: 'utf8' },
        )
        assert.equal(result.status, 0, result.stderr)
        assert.equal(JSON.parse(result.stdout).decision === 'allow', allowed, command)
      }
    }
  },
)
