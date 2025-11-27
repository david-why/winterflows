import type { EnvelopedEvent } from '@slack/bolt'
import type { SlackEvent } from '@slack/types'
import type { Workflow } from '../database/workflows'
import slack from '../clients/slack'
import { generateWorkflowEditView, generateWorkflowView } from './blocks'

export async function handleWorkflowEvent({
  event,
  envelope,
  workflow,
}: {
  event: SlackEvent
  envelope: EnvelopedEvent
  workflow: Workflow
}) {
  if (!workflow.access_token) return

  if (event.type === 'app_home_opened') {
    if (event.tab !== 'home') return

    const blocks =
      event.user === workflow.creator_user_id
        ? await generateWorkflowEditView(workflow)
        : await generateWorkflowView(workflow)

    await slack.views.publish({
      token: workflow.access_token,
      user_id: event.user,
      view: { type: 'home', blocks },
    })
  }
}
