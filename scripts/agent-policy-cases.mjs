import { homedir } from 'node:os'
import { win32 } from 'node:path'

export const shells = [
  win32.join(
    process.env.SystemRoot ?? 'C:\\WINDOWS',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  ),
  win32.join(
    homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe',
  ),
]

// Shared by generated-rule tests and diagnostics of installed user rules.
export const permissionCases = [
  ['Get-Command mise', true],
  ['mise exec -- node --version', true],
  ['mise run fix', true],
  ['mise run knip', true],
  ['mise run agent:ready', true],
  ['mise run agent:ready; git reset --hard', false],
  ['mise run lint:docs', true],
  ['mise run install', true],
  ['mise run generate:check', true],
  ['node scripts/agent-command.mjs', true],
  ['node scripts/agent-push.mjs', true],
  ['node scripts/agent-worktree-cleanup.mjs', true],
  ['mise run agent:worktree-cleanup', true],
  ['mise run fix; git reset --hard', false],
  ['mise run fix > output.txt', false],
  ['node -e "process.exit()"', false],
  ['Remove-Item -Recurse .', false],
  ['node scripts/agent-worktree-cleanup.mjs; Remove-Item -Recurse .', false],
  ['git push origin main', false],
]
