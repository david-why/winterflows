import type { EnvelopedEvent } from '@slack/bolt'
import type { SlackEvent } from '@slack/types'
import type { Workflow } from '../database/workflows'
import { updateHomeTab } from './blocks'
import { getTriggersByTypeAndString } from '../database/triggers'
import { executeTriggerFunction } from '../triggers/functions'

export async function handleWorkflowEvent({
  event,
  workflow,
}: {
  event: SlackEvent
  envelope: EnvelopedEvent
  workflow: Workflow
}) {
  if (!workflow.access_token) return

  if (event.type === 'app_home_opened') {
    if (event.tab !== 'home') return

    await updateHomeTab(workflow, event.user)
  } else if (event.type === 'message') {
    const triggers = await getTriggersByTypeAndString('message', event.channel)

    await Promise.allSettled(
      triggers.map((t) => executeTriggerFunction(t, event))
    )
  } else if (event.type === 'reaction_added') {
    const triggers = await getTriggersByTypeAndString(
      'reaction',
      `${event.item.channel}|${event.reaction}`
    )

    await Promise.allSettled(
      triggers.map((t) => executeTriggerFunction(t, event))
    )
  }
}
