import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAllowed } from './agent-command.mjs'

test('CLI accepts UTF-8 JSON with and without BOM and preserves literal Cyrillic arguments', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-command-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  mkdirSync(join(cwd, 'artifacts'))
  execFileSync('git', ['init', '--quiet'], { cwd })
  const cli = fileURLToPath(new URL('./agent-command.mjs', import.meta.url))
  const value = 'Привет; $(echo changed) & "мир"'
  for (const prefix of ['', '\uFEFF']) {
    // Use an allowed Git operation to observe literal argv without changing the allowlist.
    writeFileSync(
      join(cwd, 'artifacts/agent-command.json'),
      prefix + JSON.stringify(['git', 'rev-parse', '--sq-quote', value]),
    )
    const result = spawnSync(process.execPath, [cli], { cwd, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), `'Привет; $(echo changed) & "мир"'`)
  }
})

test('allows routine Git and GitHub operations', () => {
  for (const command of [
    ['git', 'add', 'backend'],
    ['git', 'commit', '-m', 'fix: preserve behavior'],
    ['git', 'switch', '-c', 'topic'],
    ['gh', 'issue', 'view', '39'],
    ['gh', 'issue', 'create', '--title', 'A title; no shell expansion'],
    ['gh', 'pr', 'create', '--body-file', 'artifacts/pr.md'],
    ['gh', 'pr', 'ready', '65'],
  ])
    assert.equal(isAllowed(command), true, JSON.stringify(command))
})

test('requires approval for publication, destructive operations and arbitrary programs', () => {
  for (const command of [
    ['git', 'push', 'origin', 'main'],
    ['git', 'push', '--force', 'origin', 'topic'],
    ['git', 'reset', '--hard'],
    ['git', 'clean', '-fd'],
    ['git', 'checkout', '--', '.'],
    ['git', 'switch', '-C', 'topic'],
    ['git', 'switch', '-c', 'topic', '--discard-changes'],
    ['git', '-c', 'alias.erase=!rm -rf .', 'erase'],
    ['gh', 'pr', 'merge', '--admin'],
    ['gh', 'api', '--method', 'DELETE', 'repos/owner/repo'],
    ['powershell', '-Command', 'anything'],
    [],
    null,
    ['git', 1],
  ])
    assert.equal(isAllowed(command), false, JSON.stringify(command))
})
