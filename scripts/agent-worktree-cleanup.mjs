import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.longpaths=true', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function stat(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

// Check every component, including existing parents of a missing target.
function checkPath(path) {
  const parent = dirname(path)
  if (parent !== path) checkPath(parent)
  if (stat(path)?.isSymbolicLink()) throw new Error(`Symlink/junction is forbidden: ${path}`)
}

function checkTree(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Symlink/junction is forbidden: ${child}`)
    if (entry.isDirectory()) checkTree(child)
  }
}

function registrations(repo) {
  return git(repo, 'worktree', 'list', '--porcelain', '-z')
    .split('\0\0')
    .filter(Boolean)
    .map((record) =>
      Object.fromEntries(
        record.split('\0').map((line) => {
          const space = line.indexOf(' ')
          return space < 0 ? [line, true] : [line.slice(0, space), line.slice(space + 1)]
        }),
      ),
    )
}

function main() {
  if (process.argv.length !== 2)
    throw new Error('Usage: node scripts/agent-worktree-cleanup.mjs (no arguments)')
  const repo = realpathSync(git(process.cwd(), 'rev-parse', '--show-toplevel').trim())
  const entries = registrations(repo)
  if (realpathSync(entries[0].worktree) !== repo)
    throw new Error('Run from the root checkout, not a linked worktree')
  const root = join(repo, 'artifacts', 'agent-worktrees')
  checkPath(root)
  const { base, names } = JSON.parse(
    readFileSync(join(repo, 'artifacts', 'agent-worktree-cleanup.json'), 'utf8'),
  )
  if (typeof base !== 'string' || !base || base.startsWith('-'))
    throw new Error('Explicit integration base is required')
  if (
    !Array.isArray(names) ||
    !names.length ||
    new Set(names).size !== names.length ||
    !names.every(
      (name) => typeof name === 'string' && /^agent-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name),
    )
  ) {
    throw new Error('Select unique names matching agent-<lowercase letters, digits, hyphens>')
  }
  const baseCommit = git(repo, 'rev-parse', '--verify', `${base}^{commit}`).trim()
  function validate(name) {
    const target = resolve(root, name)
    if (dirname(target) !== root || parse(target).root === target)
      throw new Error(`Forbidden target: ${target}`)
    checkPath(target)
    const entry = entries.find((item) => resolve(item.worktree) === target)
    const present = stat(target)
    if (!entry) {
      if (present) throw new Error(`Unregistered target: ${target}`)
      return { name, target, absent: true }
    }
    if (entry.locked || entry.bare || !entry.HEAD)
      throw new Error(`Locked or invalid worktree: ${target}`)
    try {
      git(repo, 'merge-base', '--is-ancestor', entry.HEAD, baseCommit)
    } catch {
      throw new Error(`Unintegrated worktree: ${target}; HEAD is not an ancestor of ${base}`)
    }
    if (present) {
      if (!present.isDirectory()) throw new Error(`Not a directory: ${target}`)
      checkTree(target)
      const common = realpathSync(
        git(target, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(),
      )
      const expected = realpathSync(
        git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(),
      )
      if (
        common !== expected ||
        realpathSync(git(target, 'rev-parse', '--show-toplevel').trim()) !== target ||
        git(target, 'rev-parse', 'HEAD').trim() !== entry.HEAD
      ) {
        throw new Error(`Foreign worktree: ${target}`)
      }
      if (
        git(target, 'ls-files', '-v', '-z')
          .split('\0')
          .some((file) => /^[a-zS]/.test(file))
      ) {
        throw new Error(
          `Index flags can hide changes: ${target}; clear assume-unchanged/skip-worktree first`,
        )
      }
      if (git(target, 'status', '--porcelain=v1', '--untracked-files=all').trim())
        throw new Error(`Dirty worktree: ${target}`)
    }
    return { name, target }
  }
  // No mutation until the entire selection has passed validation.
  const targets = names.map(validate)
  let failed = false
  for (const { name, target, absent } of targets) {
    validate(name)
    try {
      if (!absent) {
        // Git owns both directory and metadata removal. The invocation-local
        // setting enables Windows extended paths without a shell or global config.
        git(repo, 'worktree', 'remove', target)
      }
      console.log(`${name}: ${absent ? 'already absent' : 'removed'}`)
    } catch (error) {
      failed = true
      console.error(`${name}: failed: ${error.message}`)
    }
  }
  process.exitCode = failed ? 1 : 0
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
