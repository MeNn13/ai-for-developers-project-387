import {
  replySchema,
  validateReply,
  ReplyValidationError,
} from '../../../scripts/opencode-protocol.mjs'

export default {
  id: 'booking.submit-reply',
  async setup(ctx) {
    await ctx.tool.transform((editor) =>
      editor.add({
        name: 'submit_reply',
        description:
          'Submit the final discussion reply, specification or approved tickets. Markdown belongs in comment/body. After acceptance the result cannot change.',
        input: replySchema,
        async execute(input, context) {
          await ctx.permission.assert({
            sessionID: context.sessionID,
            agent: context.agent,
            action: 'submit_reply',
            resources: ['reply'],
          })
          try {
            validateReply(input)
          } catch (error) {
            if (error instanceof ReplyValidationError)
              throw new Error(`Invalid reply: ${error.field} ${error.reason}`)
            throw new Error('Invalid reply')
          }
          return { content: 'Reply accepted' }
        },
      }),
    )
  },
}
