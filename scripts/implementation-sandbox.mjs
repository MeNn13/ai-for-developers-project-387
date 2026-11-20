import { mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Candidate code can write build outputs, never the checkout, evidence or runner command files.
const root = resolve(process.env.REPAIR_CANDIDATE_ROOT ?? process.cwd())
process.chdir(root)
const writable = [
  'artifacts',
  'frontend/dist',
  'frontend/node_modules/.vite',
  'frontend/node_modules/.tmp',
  'frontend/node_modules/.vite-temp',
  'node_modules/.vite-temp',
  'node_modules/.vitest-cache',
  '.rumdl_cache',
]
for (const entry of readdirSync('backend', { withFileTypes: true })) {
  if (entry.isDirectory())
    for (const name of ['bin', 'obj']) writable.push(`backend/${entry.name}/${name}`)
}
const args = [
  '--ro-bind',
  '/',
  '/',
  '--unshare-pid',
  '--unshare-uts',
  '--unshare-ipc',
  '--unshare-user',
  '--uid',
  String(process.getuid()),
  '--gid',
  String(process.getgid()),
  '--cap-drop',
  'ALL',
  '--proc',
  '/proc',
  '--dev',
  '/dev',
  '--tmpfs',
  '/tmp',
  '--chdir',
  root,
  '--clearenv',
]
for (const key of ['PATH', 'MISE_CONFIG_DIR', 'DOTNET_ROOT'])
  if (process.env[key]) args.push('--setenv', key, process.env[key])
args.push(
  '--dir',
  '/tmp/home',
  '--setenv',
  'HOME',
  '/tmp/home',
  '--setenv',
  'MISE_DATA_DIR',
  process.env.MISE_DATA_DIR ?? resolve(process.env.HOME, '.local/share/mise'),
  '--setenv',
  'NUGET_PACKAGES',
  process.env.NUGET_PACKAGES ?? resolve(process.env.HOME, '.nuget/packages'),
  '--setenv',
  'PLAYWRIGHT_BROWSERS_PATH',
  process.env.PLAYWRIGHT_BROWSERS_PATH ?? resolve(process.env.HOME, '.cache/ms-playwright'),
  '--setenv',
  'MISE_TRUSTED_CONFIG_PATHS',
  root,
  '--setenv',
  'MISE_CACHE_DIR',
  '/tmp/mise-cache',
  '--setenv',
  'MISE_STATE_DIR',
  '/tmp/mise-state',
  '--setenv',
  'CI',
  'true',
)
for (const path of writable) {
  const absolute = resolve(path)
  mkdirSync(absolute, { recursive: true })
  args.push('--bind', absolute, absolute)
}
// Keep candidate output inside the sandbox. Only the trusted parent names a failed task.
const deadline = Date.now() + 12 * 60 * 1000
function isolated(command, diagnostic) {
  const remaining = deadline - Date.now()
  const child =
    remaining > 0 &&
    spawnSync('/usr/bin/bwrap', [...args, ...command], {
      stdio: 'ignore',
      timeout: remaining,
    })
  if (!child || child.error?.code === 'ETIMEDOUT') process.exit(124)
  if (child.status !== 0) {
    console.log(diagnostic)
    process.exit(1)
  }
}
isolated(
  ['sh', '-ec', 'mise --version && git rev-parse HEAD && test -w artifacts && test ! -w mise.toml'],
  'sandbox_launch',
)
const mise = process.env.MISE_BIN_PATH ?? 'mise'
const info = spawnSync(mise, ['tasks', 'info', 'check', '--json'], {
  cwd: resolve(import.meta.dirname, '..'),
  encoding: 'utf8',
})
let steps
try {
  const definition = JSON.parse(info.stdout)
  steps = definition.run
  if (
    info.status !== 0 ||
    !steps?.length ||
    definition.depends.length ||
    definition.depends_post.length ||
    !steps.every(
      (step) =>
        Object.keys(step).length === 1 &&
        typeof step.task === 'string' &&
        /^[a-z][a-z0-9:-]*$/.test(step.task),
    )
  )
    throw new Error()
} catch {
  console.log('check_definition')
  process.exit(1)
}
for (const step of steps) {
  isolated(['mise', 'run', step.task], 'task_failed task=' + step.task)
}
