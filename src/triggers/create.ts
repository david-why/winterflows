import { addTrigger, type Trigger } from '../database/triggers'

export async function createTimeTrigger(
  time: number,
  trigger: Omit<Trigger, 'id' | 'type' | 'val_string' | 'val_number'>
) {
  await addTrigger({
    ...trigger,
    type: 'time',
    val_string: null,
    val_number: time,
  })
}

export async function createMessageTrigger(
  channel: string,
  trigger: Omit<Trigger, 'id' | 'type' | 'val_string' | 'val_number'>
) {
  await addTrigger({
    ...trigger,
    type: 'message',
    val_string: channel,
    val_number: null,
  })
}

export async function createReactionTrigger(
  channel: string,
  reaction: string,
  trigger: Omit<Trigger, 'id' | 'type' | 'val_string' | 'val_number'>
) {
  await addTrigger({
    ...trigger,
    type: 'reaction',
    val_string: `${channel}|${reaction}`,
    val_number: null,
  })
}
