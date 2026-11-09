import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  cpSync,
  symlinkSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const run = (directory, ...args) =>
  spawnSync(process.execPath, [resolve(directory, 'contract/server/generate.mjs'), ...args], {
    encoding: 'utf8',
  })

test('generation restores stale outputs and check detects drift without modifying them', (t) => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'server-generation-test-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(resolve(fixture, 'contract/server'), { recursive: true })
  cpSync(resolve(root, 'contract/main.tsp'), resolve(fixture, 'contract/main.tsp'))
  for (const file of ['generate.mjs', 'patch-emitter.mjs', 'package.json']) {
    cpSync(resolve(root, 'contract/server', file), resolve(fixture, 'contract/server', file))
  }
  symlinkSync(
    resolve(root, 'contract/server/node_modules'),
    resolve(fixture, 'contract/server/node_modules'),
    'junction',
  )
  const generated = resolve(fixture, 'backend/BookingCalendar.Api/Generated')
  const first = run(fixture)
  assert.equal(first.status, 0, first.stdout + first.stderr)
  assert.equal(run(fixture, '--check').status, 0)
  const health = resolve(generated, 'Models/HealthResponse.cs')
  writeFileSync(health, '// stale\n')
  const stale = run(fixture, '--check')
  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /HealthResponse.cs/)
  assert.equal(readFileSync(health, 'utf8'), '// stale\n')
  assert.equal(run(fixture).status, 0)
  rmSync(health)
  assert.notEqual(run(fixture, '--check').status, 0)
  assert.equal(run(fixture).status, 0)
  writeFileSync(resolve(generated, 'extra.cs'), '// untracked\n')
  assert.notEqual(run(fixture, '--check').status, 0)
  assert.equal(run(fixture).status, 0)
  assert.equal(run(fixture, '--check').status, 0)
})

test('patch accepts repeated application but refuses an incompatible version or edited source', (t) => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'emitter-patch-test-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const server = resolve(fixture, 'contract/server')
  mkdirSync(server, { recursive: true })
  cpSync(resolve(root, 'contract/server/patch-emitter.mjs'), resolve(server, 'patch-emitter.mjs'))
  const emitter = resolve(server, 'node_modules/@typespec/http-server-csharp')
  const upstream = resolve(root, 'contract/server/node_modules/@typespec/http-server-csharp')
  for (const file of [
    'package.json',
    'dist/src/components/models/models.js',
    'dist/src/components/type-expression/type-expression.js',
  ]) {
    mkdirSync(resolve(emitter, file, '..'), { recursive: true })
    cpSync(resolve(upstream, file), resolve(emitter, file))
  }
  const patch = () =>
    spawnSync(process.execPath, [resolve(server, 'patch-emitter.mjs')], { encoding: 'utf8' })
  assert.equal(patch().status, 0)
  assert.equal(patch().status, 0)
  const manifestPath = resolve(emitter, 'package.json')
  const manifest = readFileSync(manifestPath, 'utf8')
  writeFileSync(manifestPath, JSON.stringify({ version: '0.58.0-alpha.33' }))
  const version = patch()
  assert.notEqual(version.status, 0)
  assert.match(version.stderr, /only supports 0.58.0-alpha.32/)
  writeFileSync(manifestPath, manifest)
  const source = resolve(emitter, 'dist/src/components/models/models.js')
  writeFileSync(source, readFileSync(source, 'utf8') + '\n// incompatible edit\n')
  const corrupted = patch()
  assert.notEqual(corrupted.status, 0)
  assert.match(corrupted.stderr, /Unexpected emitter source.*refusing patch/)
})
