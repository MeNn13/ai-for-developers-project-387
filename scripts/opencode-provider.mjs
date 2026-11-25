export const cloudflareModel = 'cloudflare-workers-ai/@cf/openai/gpt-oss-20b'

export const retryableProviderErrors = new Set([
  'provider.no-route',
  'provider.free-limit',
  'provider.rate-limit',
  'provider.internal',
  'provider.transport',
  'provider.timeout',
])
const otherProviderErrors = new Set([
  'provider.auth',
  'provider.quota',
  'provider.invalid-request',
  'provider.invalid-output',
  'provider.unsupported-operation',
  'permission.rejected',
  'tool.execution',
])

export function providerFailure(stdout) {
  for (const line of (stdout ?? '').split(/\r?\n/)) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.type !== 'error') continue
    const { type, name, status, data } = event.error ?? {}
    const category =
      retryableProviderErrors.has(type) || otherProviderErrors.has(type)
        ? type
        : ['AgentNotFoundError', 'StepFailedError', 'APIError', 'ProviderAuthError'].includes(name)
          ? name
          : undefined
    const responseStatus = status ?? data?.statusCode
    return {
      category,
      status:
        Number.isInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599
          ? responseStatus
          : undefined,
    }
  }
  return {}
}

export function retryableReviewFailure({ category, status }) {
  if (
    [
      'provider.auth',
      'ProviderAuthError',
      'provider.invalid-request',
      'provider.invalid-output',
      'provider.unsupported-operation',
      'permission.rejected',
      'tool.execution',
      'AgentNotFoundError',
    ].includes(category) ||
    (status >= 400 &&
      status < 500 &&
      status !== 408 &&
      status !== 429 &&
      !(status === 402 && ['provider.free-limit', 'provider.quota'].includes(category)))
  )
    return false
  return (
    retryableProviderErrors.has(category) ||
    category === 'provider.quota' ||
    status === 408 ||
    status === 429 ||
    status >= 500
  )
}
