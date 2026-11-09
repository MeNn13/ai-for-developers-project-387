import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('common generation checks client artifacts without repairing modified, missing or extra files', (t) => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'common-generation-test-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  for (const file of [
    'scripts/generate.mjs',
    'contract/main.tsp',
    'contract/package.json',
    'contract/tspconfig.yaml',
    'contract/orval.config.ts',
    'contract/server/generate.mjs',
    'contract/server/patch-emitter.mjs',
  ]) {
    mkdirSync(resolve(fixture, file, '..'), { recursive: true })
    cpSync(resolve(root, file), resolve(fixture, file))
  }
  symlinkSync(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'junction')
  symlinkSync(
    resolve(root, 'contract/server/node_modules'),
    resolve(fixture, 'contract/server/node_modules'),
    'junction',
  )
  const run = (...args) =>
    spawnSync(process.execPath, [resolve(fixture, 'scripts/generate.mjs'), ...args], {
      encoding: 'utf8',
    })
  const generate = run()
  assert.equal(generate.status, 0, generate.stdout + generate.stderr)
  assert.equal(run('--check').status, 0)
  for (const file of ['contract/openapi/openapi.yaml', 'frontend/src/api/generated/booking.ts']) {
    const output = resolve(fixture, file)
    const original = readFileSync(output)
    writeFileSync(output, '// stale\n')
    const stale = run('--check')
    assert.notEqual(stale.status, 0)
    assert.match(stale.stderr, /Stale client artifacts/)
    assert.equal(readFileSync(output, 'utf8'), '// stale\n')
    rmSync(output)
    assert.notEqual(run('--check').status, 0)
    assert.throws(() => readFileSync(output), { code: 'ENOENT' })
    writeFileSync(output, original)
  }
  for (const directory of ['contract/openapi', 'frontend/src/api/generated']) {
    const extra = resolve(fixture, directory, 'extra.txt')
    writeFileSync(extra, '// untracked\n')
    assert.notEqual(run('--check').status, 0)
    assert.equal(readFileSync(extra, 'utf8'), '// untracked\n')
    assert.equal(run().status, 0)
    assert.throws(() => readFileSync(extra), { code: 'ENOENT' })
  }
  const health = resolve(fixture, 'backend/BookingCalendar.Api/Generated/Models/HealthResponse.cs')
  writeFileSync(health, '// stale server\n')
  assert.notEqual(run('--check').status, 0)
  assert.equal(readFileSync(health, 'utf8'), '// stale server\n')
  assert.equal(run().status, 0)
  assert.equal(run('--check').status, 0)
})
