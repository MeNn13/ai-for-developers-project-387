import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const script = resolve(import.meta.dirname, 'agent-hooks.mjs')

for (const legacy of [false, true]) {
  test(`installed hooks run automatically in checkout and worktree (legacy=${legacy})`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'hooks-ready-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(directory, 'absent-config'),
      GIT_CONFIG_NOSYSTEM: '1',
      MISE_TRUSTED_CONFIG_PATHS: directory,
    }
    const run = (program, args, cwd = directory) =>
      spawnSync(program, args, { cwd, env, encoding: 'utf8' })
    const git = (...args) => {
      const result = run('git', args)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      return result.stdout + result.stderr
    }
    git('init')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Fixture')
    copyFileSync(resolve(import.meta.dirname, '../mise.toml'), join(directory, 'mise.toml'))
    writeFileSync(
      join(directory, 'hk.pkl'),
      'amends "package://github.com/jdx/hk/releases/download/v2.9.0/hk@2.9.0#/Config.pkl"\nhooks {\n' +
        ['pre-commit', 'commit-msg', 'pre-push']
          .map((event) => `["${event}"] { steps { ["observe"] { check = "echo ${event}" } } }`)
          .join('\n') +
        '\n}\n',
    )
    let result = run(process.execPath, [script])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /mise run hooks:install/)
    const before = git('config', '--local', '--list')
    run(process.execPath, [script])
    assert.equal(git('config', '--local', '--list'), before)
    result = run(process.env.MISE_TEST_BIN, ['run', 'hooks:install'])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    if (legacy) {
      result = run(process.env.MISE_TEST_BIN, ['exec', '--', 'hk', 'install', '--mise', '--legacy'])
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
    result = run(process.execPath, [script])
    assert.equal(
      result.status,
      0,
      result.stdout +
        result.stderr +
        (legacy ? readFileSync(join(directory, '.git/hooks/pre-commit'), 'utf8') : ''),
    )
    git('add', '.')
    const output = git('commit', '-m', 'initial')
    assert.match(output, /observe|pre-commit|commit-msg/)
    git('worktree', 'add', join(directory, 'child'), '-b', 'child')
    const child = join(directory, 'child')
    result = run(process.execPath, [script], child)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    result = run('git', ['commit', '--allow-empty', '-m', 'worktree'], child)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, /observe|pre-commit|commit-msg/)
    if (legacy) {
      git('config', 'core.hooksPath', 'missing-hooks')
    } else {
      git('config', 'hook.hk-pre-push.enabled', 'false')
    }
    result = run(process.execPath, [script], child)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /mise run hooks:install/)
  })
}
