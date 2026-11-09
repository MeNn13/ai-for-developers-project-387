import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, sep } from 'node:path'

const directory = fileURLToPath(new URL('.', import.meta.url))
const root = fileURLToPath(new URL('../../', import.meta.url))
// Never resolve generation dependencies from the frontend workspace or globally.
for (const dependency of [
  import.meta.resolve('@typespec/compiler'),
  import.meta.resolve('@typespec/http'),
  import.meta.resolve('@typespec/http-server-csharp'),
  import.meta.resolve('@typespec/json-schema'),
  import.meta.resolve('@typespec/openapi'),
  import.meta.resolve('@typespec/rest'),
  import.meta.resolve('@typespec/versioning'),
]) {
  if (!fileURLToPath(dependency).startsWith(realpathSync(join(directory, 'node_modules')) + sep)) {
    throw new Error(`Dependency escaped isolated server generation: ${dependency}`)
  }
}
const check = process.argv.includes('--check')
if (process.argv.slice(2).some((argument) => argument !== '--check'))
  throw new Error('Usage: generate.mjs [--check]')

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: directory, stdio: 'inherit' })
  if (result.status !== 0)
    throw new Error(`Server generation command failed: ${args[0]} (exit ${result.status})`)
}

// Patch is explicit on every generation, including the first run after npm ci.
run(['patch-emitter.mjs'])
const staging = join(root, 'artifacts/server-generation')
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
copyFileSync(join(root, 'contract/main.tsp'), join(directory, 'main.tsp'))
try {
  run([
    'node_modules/@typespec/compiler/cmd/tsp.js',
    'compile',
    'main.tsp',
    '--emit',
    '@typespec/http-server-csharp',
    '--option',
    '@typespec/http-server-csharp.output-type=models',
    '--option',
    '@typespec/http-server-csharp.skip-format=true',
    '--output-dir',
    staging,
  ])
} finally {
  rmSync(join(directory, 'main.tsp'), { force: true })
}
const emitted = join(staging, '@typespec/http-server-csharp/generated')
const selected = join(staging, 'selected')
mkdirSync(selected)
cpSync(join(emitted, 'models'), join(selected, 'Models'), { recursive: true })
mkdirSync(join(selected, 'Lib'))
for (const file of readdirSync(join(emitted, 'lib'))) {
  if (file.endsWith('.cs') && file !== 'HttpServiceException.cs') {
    copyFileSync(join(emitted, 'lib', file), join(selected, 'Lib', file))
  }
}
const output = join(root, 'backend/BookingCalendar.Api/Generated')
function files(directory, prefix = '') {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        const name = join(prefix, entry.name)
        return entry.isDirectory() ? files(join(directory, entry.name), name) : [name]
      })
      .sort()
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}
if (check) {
  const differences = [...new Set([...files(output), ...files(selected)])].filter((name) => {
    try {
      return !readFileSync(join(output, name)).equals(readFileSync(join(selected, name)))
    } catch (error) {
      if (error.code === 'ENOENT') return true
      throw error
    }
  })
  if (differences.length) {
    console.error(`Stale server artifacts; run mise run generate:\n${differences.join('\n')}`)
    process.exitCode = 1
  }
} else {
  // This whole directory is owned by this generator; no handwritten files belong here.
  rmSync(output, { recursive: true, force: true })
  cpSync(selected, output, { recursive: true })
}
