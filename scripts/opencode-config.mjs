import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const config = JSON.parse(
  readFileSync(new URL('../.github/opencode/opencode.json', import.meta.url), 'utf8'),
)
config.update = 'disable'
config.plugins = [fileURLToPath(new URL('../.github/opencode/submit-reply/', import.meta.url))]
config.permissions.push({ action: 'submit_reply', resource: '*', effect: 'allow' })
config.policies.push({ action: 'tool.use', resource: 'submit_reply:reply', effect: 'allow' })
process.stdout.write(JSON.stringify(config))
