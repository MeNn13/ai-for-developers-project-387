import { createSign } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

// Runs only in the publisher job. No artifact or model controls the endpoints.
if (process.argv[2] === 'revoke') {
  const response = await fetch('https://api.github.com/installation/token', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}` },
  })
  if (!response.ok) throw new Error('token_revocation')
} else {
  const app = process.env.PUBLISH_APP_ID
  const installation = process.env.PUBLISH_INSTALLATION_ID
  if (!/^\d+$/.test(app) || !/^\d+$/.test(installation)) throw new Error('app_configuration')
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 60, exp: now + 540, iss: app })}`
  const signature = createSign('RSA-SHA256')
    .update(input)
    .sign(process.env.PUBLISH_APP_PRIVATE_KEY, 'base64url')
  const response = await fetch(
    `https://api.github.com/app/installations/${installation}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input}.${signature}`,
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({
        repositories: ['ai-for-developers-project-387'],
        permissions: { contents: 'write', pull_requests: 'write', issues: 'read', actions: 'read' },
      }),
    },
  )
  if (!response.ok) throw new Error('app_authentication')
  const { token } = await response.json()
  if (typeof token !== 'string' || /[\r\n]/.test(token)) throw new Error('app_authentication')
  console.log(`::add-mask::${token}`)
  await writeFile(process.env.GITHUB_ENV, `GH_TOKEN=${token}\n`, { flag: 'a' })
}
