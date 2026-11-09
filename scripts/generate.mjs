import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const check = process.argv.includes('--check')
if (process.argv.slice(2).some((argument) => argument !== '--check'))
  throw new Error('Usage: generate.mjs [--check]')

function run(script, args = [], cwd = root) {
  const result = spawnSync(process.execPath, [join(root, script), ...args], {
    cwd,
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error(`Generation failed: ${script} (exit ${result.status})`)
}

const staging = join(root, 'artifacts/client-generation')
rmSync(staging, { recursive: true, force: true })
mkdirSync(join(staging, 'contract'), { recursive: true })
for (const file of ['main.tsp', 'package.json', 'tspconfig.yaml', 'orval.config.ts']) {
  copyFileSync(join(root, 'contract', file), join(staging, 'contract', file))
}
run('node_modules/@typespec/compiler/cmd/tsp.js', ['compile', '.'], join(staging, 'contract'))
run('node_modules/orval/dist/bin/orval.mjs', [], join(staging, 'contract'))

function files(directory, prefix = '') {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const name = join(prefix, entry.name)
      return entry.isDirectory() ? files(join(directory, entry.name), name) : [name]
    })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

const outputs = ['contract/openapi', 'frontend/src/api/generated']
if (check) {
  const differences = outputs.flatMap((output) => {
    const actual = join(root, output)
    const expected = join(staging, output)
    return [...new Set([...files(actual), ...files(expected)])]
      .sort()
      .filter((file) => {
        try {
          return !readFileSync(join(actual, file)).equals(readFileSync(join(expected, file)))
        } catch (error) {
          if (error.code === 'ENOENT') return true
          throw error
        }
      })
      .map((file) => join(output, file))
  })
  if (differences.length) {
    console.error(`Stale client artifacts; run mise run generate:\n${differences.join('\n')}`)
    process.exitCode = 1
  } else {
    run('contract/server/generate.mjs', ['--check'])
  }
} else {
  run('contract/server/generate.mjs')
  // Each output directory is wholly generator-owned, including obsolete files.
  for (const output of outputs) {
    rmSync(join(root, output), { recursive: true, force: true })
    cpSync(join(staging, output), join(root, output), { recursive: true })
  }
}
