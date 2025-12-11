import { defineStep } from '.'
import type { ExecutionContext } from '../context'

async function identity(_ctx: ExecutionContext, { value }: { value: string }) {
  return { value }
}

export default {
  'convert-user-to-id': defineStep(identity, {
    name: 'Convert user to user ID',
    category: 'Convert',
    inputs: {
      value: { type: 'user', name: 'User', required: true },
    },
    outputs: {
      value: { type: 'text', name: 'User ID', required: true },
    },
  }),
  'convert-user-id-to-user': defineStep(identity, {
    name: 'Convert user ID to user',
    category: 'Convert',
    inputs: {
      value: {
        type: 'user',
        name: 'User ID',
        required: true,
        description:
          'It is your responsibility to ensure this is a valid user ID. Otherwise, later steps that use this user may fail.',
      },
    },
    outputs: {
      value: { type: 'user', name: 'User', required: true },
    },
  }),
}
