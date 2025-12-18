import type { Button, KnownBlock, MessageAttachment } from '@slack/types'
import { defineStep, PENDING } from '.'
import slack from '../../clients/slack'
import type { ExecutionContext } from '../context'
import z from 'zod'

const MessageComponents = z.array(
  z.object({
    name: z.string().min(1).max(75),
    style: z.literal(['primary', 'danger']).optional(),
  })
)
type MessageComponents = z.infer<typeof MessageComponents>

function generateComponents(data: string, ctx: ExecutionContext): Button[] {
  if (!data) return []

  let parsed: any[]
  try {
    parsed = JSON.parse(data)
  } catch {
    throw new Error('The `components` parameter is not valid JSON.')
  }

  const components = MessageComponents.parse(parsed)

  return components.map((c, i) => ({
    type: 'button',
    text: { type: 'plain_text', text: c.name, emoji: true },
    action_id: `message_button_${i}`,
    style: c.style,
    value: JSON.stringify({
      execution: ctx.execution.id,
      step: ctx.step_id,
      value: c.name,
    }),
  }))
}

async function sendMessageToUser(
  ctx: ExecutionContext,
  {
    user_id,
    message,
    components,
  }: { user_id: string; message: string; components: string }
) {
  const buttons = generateComponents(components, ctx)
  const actionAttachments: MessageAttachment[] | undefined = buttons.length
    ? [{ blocks: [{ type: 'actions', elements: buttons }] }]
    : undefined

  const msg = await slack.chat.postMessage({
    token: ctx.token,
    channel: user_id,
    blocks: [JSON.parse(message)],
    attachments: actionAttachments,
  })

  if (buttons.length) {
    return PENDING
  }

  return {
    message: JSON.stringify({ channel: msg.channel!, ts: msg.ts! }),
    component: '',
    user: '',
  }
}

async function sendMessageToChannel(
  ctx: ExecutionContext,
  {
    channel,
    message,
    components,
  }: { channel: string; message: string; components: string }
) {
  const buttons = generateComponents(components, ctx)
  const actionAttachments: MessageAttachment[] | undefined = buttons.length
    ? [{ blocks: [{ type: 'actions', elements: buttons }] }]
    : undefined

  const msg = await slack.chat.postMessage({
    token: ctx.token,
    channel,
    blocks: [JSON.parse(message)],
    attachments: actionAttachments,
  })

  if (buttons.length) {
    return PENDING
  }
  return {
    message: JSON.stringify({ channel: msg.channel!, ts: msg.ts! }),
    component: '',
    user: '',
  }
}

async function replyToMessage(
  ctx: ExecutionContext,
  {
    thread,
    message,
    components,
  }: { thread: string; message: string; components: string }
) {
  const { channel, ts } = JSON.parse(thread)
  const buttons = generateComponents(components, ctx)
  const actionAttachments: MessageAttachment[] | undefined = buttons.length
    ? [{ blocks: [{ type: 'actions', elements: buttons }] }]
    : undefined

  const msg = await slack.chat.postMessage({
    token: ctx.token,
    channel,
    thread_ts: ts,
    blocks: [JSON.parse(message)],
    attachments: actionAttachments,
  })

  if (buttons.length) {
    return PENDING
  }
  return {
    message: JSON.stringify({ channel: msg.channel!, ts: msg.ts! }),
    component: '',
    user: '',
  }
}

async function addReactionToMessage(
  ctx: ExecutionContext,
  { message, emoji }: { message: string; emoji: string }
) {
  const { channel, ts } = JSON.parse(message)
  try {
    await slack.reactions.add({
      token: ctx.token,
      channel,
      timestamp: ts,
      name: emoji,
    })
  } catch (e: any) {
    if (e.data?.error !== 'already_reacted') {
      throw e
    }
  }
  return {}
}

async function removeReactionFromMessage(
  ctx: ExecutionContext,
  { message, emoji }: { message: string; emoji: string }
) {
  const { channel, ts } = JSON.parse(message)
  try {
    await slack.reactions.remove({
      token: ctx.token,
      channel,
      timestamp: ts,
      name: emoji,
    })
  } catch (e: any) {
    if (e.data?.error !== 'no_reaction') {
      throw e
    }
  }
  return {}
}

async function sendEphemeralMessage(
  ctx: ExecutionContext,
  { channel, user, message }: { channel: string; user: string; message: string }
) {
  slack.chat.postEphemeral({
    token: ctx.token,
    channel,
    user,
    blocks: [JSON.parse(message)],
  })
  return {}
}

export default {
  'dm-user': defineStep(sendMessageToUser, {
    name: 'Send a message to a person',
    category: 'Messages',
    inputs: {
      user_id: { name: 'User', required: true, type: 'user' },
      message: { name: 'Message', required: true, type: 'rich_text' },
      components: {
        name: 'Interactive components',
        required: false,
        type: 'text',
        description:
          'Enter a JSON array of interactive buttons. You can use the helper on the App Home of Winterflows to help you build this array.',
      },
    },
    outputs: {
      message: { name: 'Sent message', required: true, type: 'message' },
      component: {
        name: 'Name of button pressed',
        required: false,
        type: 'text',
      },
      user: {
        name: 'User who pressed the button',
        required: false,
        type: 'user',
      },
    },
  }),
  'message-channel': defineStep(sendMessageToChannel, {
    name: 'Send a message to a channel',
    category: 'Messages',
    inputs: {
      channel: { name: 'Channel', required: true, type: 'channel' },
      message: { name: 'Message', required: true, type: 'rich_text' },
      components: {
        name: 'Interactive components',
        required: false,
        type: 'text',
        description:
          'Enter a JSON array of interactive buttons. You can use the helper on the App Home of Winterflows to help you build this array.',
      },
    },
    outputs: {
      message: { name: 'Sent message', required: true, type: 'message' },
      component: {
        name: 'Name of button pressed',
        required: false,
        type: 'text',
      },
      user: {
        name: 'User who pressed the button',
        required: false,
        type: 'user',
      },
    },
  }),
  'message-reply': defineStep(replyToMessage, {
    name: 'Reply to a message in thread',
    category: 'Messages',
    inputs: {
      thread: { name: 'Message to reply to', required: true, type: 'message' },
      message: { name: 'Message', required: true, type: 'rich_text' },
      components: {
        name: 'Interactive components',
        required: false,
        type: 'text',
        description:
          'Enter a JSON array of interactive buttons. You can use the helper on the App Home of Winterflows to help you build this array.',
      },
    },
    outputs: {
      message: { name: 'Sent message', required: true, type: 'message' },
      component: {
        name: 'Name of button pressed',
        required: false,
        type: 'text',
      },
      user: {
        name: 'User who pressed the button',
        required: false,
        type: 'user',
      },
    },
  }),
  'react-message': defineStep(addReactionToMessage, {
    name: 'Add a reaction to a message',
    category: 'Messages',
    inputs: {
      message: { name: 'Message', required: true, type: 'message' },
      emoji: {
        name: 'Emoji name (without colons)',
        required: true,
        type: 'text',
      },
    },
    outputs: {},
  }),
  'unreact-message': defineStep(removeReactionFromMessage, {
    name: 'Remove a reaction from a message',
    category: 'Messages',
    inputs: {
      message: { name: 'Message', required: true, type: 'message' },
      emoji: {
        name: 'Emoji name (without colons)',
        required: true,
        type: 'text',
      },
    },
    outputs: {},
  }),
  'send-ephemeral': defineStep(sendEphemeralMessage, {
    name: 'Send an "only visible to you" message',
    category: 'Messages',
    inputs: {
      channel: { name: 'Channel', required: true, type: 'channel' },
      user: { name: 'User', required: true, type: 'user' },
      message: { name: 'Message', required: true, type: 'rich_text' },
    },
    outputs: {},
  }),
}
