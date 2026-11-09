import { execFileSync } from 'node:child_process'

// Git hooks export repository-local variables. Fixtures must select their own repositories.
const variables = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' })
for (const name of variables.trim().split(/\r?\n/)) delete process.env[name]
