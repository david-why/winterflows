import slack from '../../clients/slack'
import type { ExecutionContext } from '../context'
import { defineStep } from '../steps'

async function sendMessageToUser(
  ctx: ExecutionContext,
  { user_id, message }: { user_id: string; message: string }
) {
  const msg = await slack.chat.postMessage({
    token: ctx.token,
    channel: user_id,
    blocks: [JSON.parse(message)],
  })
  return {
    message: JSON.stringify({ channel: msg.channel!, ts: msg.ts! }),
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

export default {
  'dm-user': defineStep(sendMessageToUser, {
    name: 'Send a message to a person',
    category: 'Messages',
    inputs: {
      user_id: { name: 'User', required: true, type: 'user' },
      message: { name: 'Message', required: true, type: 'rich_text' },
    },
    outputs: {
      message: {
        name: 'Sent message',
        required: true,
        type: 'message',
      },
    },
  }),
  'react-message': defineStep(addReactionToMessage, {
    name: 'Add a reaction to a message',
    category: 'Messages',
    inputs: {
      message: {
        name: 'Message',
        required: true,
        type: 'message',
      },
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
      message: {
        name: 'Message',
        required: true,
        type: 'message',
      },
      emoji: {
        name: 'Emoji name (without colons)',
        required: true,
        type: 'text',
      },
    },
    outputs: {},
  }),
}
