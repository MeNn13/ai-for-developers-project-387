import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./encoding-check.mjs', import.meta.url))

function repository(t) {
  const directory = mkdtempSync(join(tmpdir(), 'encoding-check-'))
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    rmSync(directory, { recursive: true, force: true })
  })
  execFileSync('git', ['init', '--quiet', directory])
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: directory })
  return directory
}

function check(directory) {
  return spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' })
}

test('deleted tracked files do not prevent checking the working tree', (t) => {
  const directory = repository(t)
  const file = join(directory, 'deleted.md')
  writeFileSync(file, 'Удаляемый файл\n')
  execFileSync('git', ['add', '--', 'deleted.md'], { cwd: directory })
  rmSync(file)

  const result = check(directory)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /clean \(0 files scanned\)/)
})

test('new files with broken encoding fail before staging', (t) => {
  const directory = repository(t)
  writeFileSync(join(directory, 'new.md'), String.fromCodePoint(0xfffd))

  const result = check(directory)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /new\.md:1: possible mojibake/)
})

test('renamed files are checked at their new path before staging', (t) => {
  const directory = repository(t)
  writeFileSync(join(directory, 'old.md'), 'Корректный текст\n')
  execFileSync('git', ['add', '--', 'old.md'], { cwd: directory })
  renameSync(join(directory, 'old.md'), join(directory, 'Новое имя.md'))
  writeFileSync(join(directory, 'Новое имя.md'), String.fromCodePoint(0xfffd))

  const result = check(directory)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /Новое имя\.md:1: possible mojibake/)
  assert.doesNotMatch(result.stderr, /ENOENT/)
})

test('ignored untracked files are skipped while valid new files are checked', (t) => {
  const directory = repository(t)
  writeFileSync(join(directory, '.gitignore'), 'ignored.md\n')
  writeFileSync(join(directory, 'ignored.md'), String.fromCodePoint(0xfffd))
  writeFileSync(join(directory, 'Новый файл.md'), 'Корректный текст\n')

  const result = check(directory)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /clean \(1 files scanned\)/)
})

test('tracked files remain checked even when an ignore rule matches them', (t) => {
  const directory = repository(t)
  writeFileSync(join(directory, 'tracked.md'), 'Корректный текст\n')
  execFileSync('git', ['add', '--', 'tracked.md'], { cwd: directory })
  writeFileSync(join(directory, '.gitignore'), 'tracked.md\n')
  writeFileSync(join(directory, 'tracked.md'), String.fromCodePoint(0xfffd))

  const result = check(directory)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /tracked\.md:1: possible mojibake/)
})
