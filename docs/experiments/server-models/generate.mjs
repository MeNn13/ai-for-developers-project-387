import { copyFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))
// Resolve every experiment dependency locally before invoking the compiler.
const dependencies = [
  import.meta.resolve('@typespec/compiler'),
  import.meta.resolve('@typespec/http'),
  import.meta.resolve('@typespec/http-server-csharp'),
  import.meta.resolve('@typespec/json-schema'),
  import.meta.resolve('@typespec/openapi'),
  import.meta.resolve('@typespec/rest'),
  import.meta.resolve('@typespec/versioning'),
]
for (const dependency of dependencies) {
  if (!fileURLToPath(dependency).startsWith(directory)) {
    throw new Error(`Dependency escaped the isolated experiment: ${dependency}`)
  }
}
mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true })
copyFileSync(
  new URL('../../../contract/main.tsp', import.meta.url),
  new URL('./artifacts/main.tsp', import.meta.url),
)
const result = spawnSync(
  process.execPath,
  [
    'node_modules/@typespec/compiler/cmd/tsp.js',
    'compile',
    'artifacts/main.tsp',
    '--emit',
    '@typespec/http-server-csharp',
    '--option',
    '@typespec/http-server-csharp.output-type=models',
    '--option',
    '@typespec/http-server-csharp.skip-format=true',
    '--output-dir',
    'artifacts/generated',
  ],
  { cwd: directory, stdio: 'inherit' },
)
process.exit(result.status ?? 1)
