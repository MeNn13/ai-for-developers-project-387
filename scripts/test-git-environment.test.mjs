import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('test bootstrap isolates Git fixtures from hook repository variables', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'git-hook-environment-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      new URL('./test-git-environment.mjs', import.meta.url).href,
      '--eval',
      `require('node:child_process').execFileSync('git', ['init', '--bare', '.'])`,
    ],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_WORK_TREE: cwd, GIT_INDEX_FILE: join(cwd, 'foreign-index') },
    },
  )
  assert.equal(result.status, 0, result.stderr)
})
