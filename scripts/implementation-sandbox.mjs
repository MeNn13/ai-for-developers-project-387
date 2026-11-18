import { mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Candidate code can write build outputs, never the checkout, evidence or runner command files.
const root = resolve(process.env.REPAIR_CANDIDATE_ROOT ?? process.cwd())
process.chdir(root)
const writable = ['artifacts', 'frontend/dist', 'frontend/node_modules/.vite']
for (const entry of readdirSync('backend', { withFileTypes: true })) {
  if (entry.isDirectory())
    for (const name of ['bin', 'obj']) writable.push(`backend/${entry.name}/${name}`)
}
const args = [
  'bwrap',
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
for (const key of [
  'PATH',
  'HOME',
  'MISE_DATA_DIR',
  'MISE_CONFIG_DIR',
  'DOTNET_ROOT',
  'PLAYWRIGHT_BROWSERS_PATH',
])
  if (process.env[key]) args.push('--setenv', key, process.env[key])
args.push(
  '--setenv',
  'MISE_TRUSTED_CONFIG_PATHS',
  root,
  '--setenv',
  'MISE_CACHE_DIR',
  '/tmp/mise-cache',
  '--setenv',
  'CI',
  'true',
)
for (const path of writable) {
  const absolute = resolve(path)
  mkdirSync(absolute, { recursive: true })
  args.push('--bind', absolute, absolute)
}
args.push('mise', 'run', 'check')
const child = spawnSync('sudo', args, { stdio: 'inherit', timeout: 12 * 60 * 1000 })
if (child.error?.code === 'ETIMEDOUT') process.exitCode = 124
else if (child.status !== 0) process.exitCode = 1
