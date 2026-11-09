import { execFileSync } from 'node:child_process'

// Explicit refspec: publish only the current topic branch to its namesake on origin.
if (process.argv.length !== 2) throw new Error('Usage: node scripts/agent-push.mjs')

const branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
  encoding: 'utf8',
}).trim()

if (/^(main|master)$/i.test(branch)) {
  throw new Error('Use a topic branch and a PR; main/master requires approval.')
}

execFileSync('git', ['check-ref-format', '--branch', branch], { stdio: 'pipe' })
execFileSync(
  'git',
  ['push', '--set-upstream', 'origin', `refs/heads/${branch}:refs/heads/${branch}`],
  {
    stdio: 'inherit',
  },
)
