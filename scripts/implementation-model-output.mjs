export class ImplementationFailure extends Error {
  constructor(category, status) {
    super(category)
    this.status = status
  }
}

export function decodeModel(child, bounded = false, structuredReply = true) {
  if (child.error?.code === 'ENOBUFS') throw new ImplementationFailure('model_output_limit')
  if (child.error || (bounded && [126, 127].includes(child.status)))
    throw new ImplementationFailure('model_launch')
  const messages = new Map()
  let sessionID
  let malformed = false
  let unknownError = false
  for (const line of (child.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
    try {
      const item = JSON.parse(line)
      if (typeof item?.type !== 'string') throw new Error()
      if (item.type === 'error') {
        if (
          ['APIError', 'ProviderAuthError'].includes(item.error?.name) ||
          ['api', 'provider-auth'].includes(item.error?.type)
        ) {
          const status = item.error.status ?? item.error.data?.statusCode
          throw new ImplementationFailure(
            'provider_error',
            Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
          )
        }
        unknownError = true
        continue
      }
      if (!['step_start', 'step_finish', 'text', 'tool_use', 'reasoning'].includes(item.type))
        throw new Error()
      const { part } = item
      sessionID ??= item.sessionID
      if (
        typeof sessionID !== 'string' ||
        !sessionID ||
        item.sessionID !== sessionID ||
        part?.sessionID !== sessionID ||
        typeof part.messageID !== 'string' ||
        !part.messageID
      )
        throw new Error()
      const message = messages.get(part.messageID) ?? { text: [], reason: undefined }
      messages.set(part.messageID, message)
      if (item.type === 'text') {
        if (typeof part.text !== 'string') throw new Error()
        // Reconciliation may emit more text for a message whose step already ended.
        message.text.push(part.text)
      }
      if (item.type === 'step_finish') {
        if (typeof part.reason !== 'string' || message.reason !== undefined) throw new Error()
        message.reason = part.reason
      }
    } catch (error) {
      if (error instanceof ImplementationFailure) throw error
      malformed = true
    }
  }
  if (unknownError) throw new ImplementationFailure('unknown')
  if (child.status !== 0)
    throw new ImplementationFailure(
      'model_exit',
      Number.isInteger(child.status) && child.status >= 0 && child.status <= 255
        ? child.status
        : undefined,
    )
  if (malformed) throw new ImplementationFailure('invalid_event_stream')
  const final = [...messages.values()].at(-1)
  if (final?.reason !== 'stop' || final.text.length === 0)
    throw new ImplementationFailure('incomplete_stream')
  if (!structuredReply) return
  try {
    return JSON.parse(final.text.join(''))
  } catch {
    throw new ImplementationFailure('invalid_result_json')
  }
}
