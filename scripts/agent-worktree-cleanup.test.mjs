import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const script = resolve(import.meta.dirname, 'agent-worktree-cleanup.mjs')

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'worktree-cleanup-'))
  const repo = join(directory, 'repo')
  mkdirSync(repo)
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  git('init', '--initial-branch=main')
  git('config', 'user.name', 'Cleanup test')
  git('config', 'user.email', 'test@example.com')
  writeFileSync(join(repo, '.gitignore'), 'artifacts/\n')
  writeFileSync(join(repo, 'tracked.txt'), 'initial\n')
  git('add', '.')
  git('-c', 'core.hooksPath=', 'commit', '-m', 'initial')
  const root = join(repo, 'artifacts', 'agent-worktrees')
  mkdirSync(root, { recursive: true })
  const add = (name) => {
    const path = join(root, name)
    git('worktree', 'add', '-b', name, path)
    return path
  }
  const run = (names, base = 'main') => {
    writeFileSync(
      join(repo, 'artifacts', 'agent-worktree-cleanup.json'),
      JSON.stringify({ base, names }),
    )
    return spawnSync(process.execPath, [script], { cwd: repo, encoding: 'utf8' })
  }
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return { repo, root, git, add, run }
}

test('removes only selected integrated worktrees, preserves branches and permits a retry', (t) => {
  const { git, add, run } = fixture(t)
  const selected = add('agent-done')
  const other = add('agent-other')
  const result = run(['agent-done'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(existsSync(selected), false)
  assert.equal(existsSync(other), true)
  assert.match(git('branch', '--list'), /agent-done/)
  assert.equal(run(['agent-done']).status, 0)
})

test('validates the whole selection before deleting any target', (t) => {
  const { add, run } = fixture(t)
  const first = add('agent-first')
  const dirty = add('agent-dirty')
  writeFileSync(join(dirty, 'untracked.txt'), 'keep me')
  const result = run(['agent-first', 'agent-dirty'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Dirty worktree/)
  assert.equal(existsSync(first), true)
  assert.equal(existsSync(join(dirty, 'untracked.txt')), true)
})

test('preserves tracked edits and unintegrated commits against an explicit base', (t) => {
  const { git, add, run } = fixture(t)
  const target = add('agent-work')
  writeFileSync(join(target, 'tracked.txt'), 'edited\n')
  assert.match(run(['agent-work']).stderr, /Dirty worktree/)
  git('-C', target, 'add', '.')
  git('-C', target, '-c', 'core.hooksPath=', 'commit', '-m', 'work')
  assert.match(run(['agent-work']).stderr, /Unintegrated worktree/)
  assert.equal(existsSync(target), true)
  assert.notEqual(run(['agent-work'], '').status, 0)
  assert.notEqual(run(['agent-work'], 'missing-ref').status, 0)
  git('merge', '--ff-only', 'agent-work')
  assert.equal(run(['agent-work']).status, 0)
})

test('removes only the selected missing registration after partial deletion', (t) => {
  const { git, add, run } = fixture(t)
  const selected = add('agent-missing')
  const other = add('agent-other')
  rmSync(selected, { recursive: true, force: true })
  rmSync(other, { recursive: true, force: true })
  const result = run(['agent-missing'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.doesNotMatch(git('worktree', 'list', '--porcelain'), /agent-missing/)
  assert.match(git('worktree', 'list', '--porcelain'), /agent-other/)
  assert.equal(run(['agent-missing']).status, 0)
})

test('rejects invalid names, unregistered directories, foreign repos and locked worktrees', (t) => {
  const { repo, root, git, add, run } = fixture(t)
  const safe = add('agent-safe')
  for (const name of [
    '..',
    repo,
    '../outside',
    'agent-x/../agent-safe',
    'AGENT-X',
    'agent-x.',
    '',
  ]) {
    assert.notEqual(run(['agent-safe', name]).status, 0, name)
    assert.equal(existsSync(safe), true)
  }
  mkdirSync(join(root, 'agent-unknown'))
  assert.match(run(['agent-unknown']).stderr, /Unregistered/)
  git('init', join(root, 'agent-foreign'))
  assert.notEqual(run(['agent-foreign']).status, 0)
  git('worktree', 'lock', safe)
  assert.match(run(['agent-safe']).stderr, /Locked/)
})

test('rejects a junction outside the allowed root before deleting another selection', (t) => {
  const { root, add, run } = fixture(t)
  const safe = add('agent-safe')
  const outside = join(root, '..', 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'keep.txt'), 'keep')
  symlinkSync(
    outside,
    join(root, 'agent-escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  assert.match(run(['agent-safe', 'agent-escape']).stderr, /Symlink\/junction/)
  assert.equal(existsSync(safe), true)
  assert.equal(existsSync(join(outside, 'keep.txt')), true)
})

test('cleans Windows-length paths through Git, including ignored build output', (t) => {
  const { add, run } = fixture(t)
  const target = add('agent-long')
  const deep = join(target, 'artifacts', ...Array(12).fill('long-directory-name'))
  assert.ok(deep.length > 260)
  mkdirSync(deep, { recursive: true })
  writeFileSync(join(deep, 'build.txt'), 'build')
  const result = run(['agent-long'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(existsSync(target), false)
})

test('rejects a linked checkout as the caller and links inside a selected worktree', (t) => {
  const { repo, add, run } = fixture(t)
  const target = add('agent-work')
  const result = spawnSync(process.execPath, [script], { cwd: target, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /root checkout/)
  symlinkSync(repo, join(target, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.match(run(['agent-work']).stderr, /Symlink\/junction/)
  assert.equal(existsSync(target), true)
})

test('preserves edits hidden by index flags', (t) => {
  const { git, add, run } = fixture(t)
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    const name = flag === '--assume-unchanged' ? 'agent-assume' : 'agent-skip'
    const target = add(name)
    git('-C', target, 'update-index', flag, 'tracked.txt')
    writeFileSync(join(target, 'tracked.txt'), 'hidden edit\n')
    const result = run([name])
    assert.notEqual(result.status, 0, result.stdout + result.stderr)
    assert.equal(existsSync(join(target, 'tracked.txt')), true)
  }
})

test('cleans tracked paths longer than 260 characters with longpaths disabled in repository config', (t) => {
  const { git, add, run } = fixture(t)
  git('config', 'core.longpaths', 'false')
  const target = add('agent-tracked-long')
  const deep = join(target, ...Array(12).fill('long-directory-name'))
  mkdirSync(deep, { recursive: true })
  writeFileSync(join(deep, 'tracked.txt'), 'tracked\n')
  git('-C', target, '-c', 'core.longpaths=true', 'add', '.')
  git(
    '-C',
    target,
    '-c',
    'core.longpaths=true',
    '-c',
    'core.hooksPath=',
    'commit',
    '-m',
    'long path',
  )
  git('-c', 'core.longpaths=true', 'merge', '--ff-only', 'agent-tracked-long')
  const result = run(['agent-tracked-long'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(existsSync(target), false)
  assert.equal(git('config', 'core.longpaths'), 'false')
})
