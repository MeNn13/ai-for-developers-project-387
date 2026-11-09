import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const script = fileURLToPath(new URL('./agent-push.mjs', import.meta.url))

test('publishes a topic branch and rejects protected branches, detached HEAD and arguments', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-push-'))
  const remote = join(root, 'remote.git')
  const local = join(root, 'local')
  const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const push = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: local })
  try {
    git(['init', '--bare', remote])
    git(['init', '--initial-branch=main', local])
    git(['config', 'user.name', 'Push test'], local)
    git(['config', 'user.email', 'test@example.com'], local)
    git(['-c', 'core.hooksPath=', 'commit', '--allow-empty', '-m', 'initial'], local)
    git(['remote', 'add', 'origin', remote], local)
    assert.notEqual(push().status, 0)
    git(['switch', '-c', 'master'], local)
    assert.notEqual(push().status, 0)
    git(['switch', '-c', 'topic'], local)
    assert.notEqual(push('--force').status, 0)
    assert.equal(push().status, 0)
    assert.equal(git(['rev-parse', 'refs/heads/topic'], remote), git(['rev-parse', 'HEAD'], local))
    assert.equal(
      git(['for-each-ref', '--format=%(refname)', 'refs/heads'], remote),
      'refs/heads/topic',
    )
    git(['checkout', '--detach'], local)
    assert.notEqual(push().status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
