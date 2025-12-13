import type { User } from '../database/users'
import { getWorkflowById } from '../database/workflows'
import {
  getWorkflowTrigger,
  deleteTriggersByWorkflowId,
} from '../database/triggers'
import { notFoundResponse, badRequestResponse } from './auth'
import { generateManifest, getActiveConfigToken } from '../utils/slack'
import slack from '../clients/slack'
import {
  createCronTrigger,
  createMemberJoinTrigger,
  createMessageTrigger,
  createReactionTrigger,
} from '../triggers/create'

function formatTriggerResponse(trigger: any) {
  const base = { workflow_id: trigger.workflow_id, type: trigger.type }

  if (trigger.type === 'cron') {
    return { ...base, schedule: trigger.val_string }
  } else if (trigger.type === 'message' || trigger.type === 'member_join') {
    return { ...base, channel_id: trigger.val_string }
  } else if (trigger.type === 'reaction') {
    const [channel, emoji] = (trigger.val_string || '|').split('|')
    return { ...base, channel_id: channel, emoji }
  }

  return base
}

export async function getWorkflowTriggerEndpoint(user: User, workflowId: number) {
  const workflow = await getWorkflowById(workflowId)

  if (!workflow || workflow.creator_user_id !== user.id) {
    return notFoundResponse('Workflow not found')
  }

  const trigger = await getWorkflowTrigger(workflowId)

  if (!trigger) {
    return Response.json({ workflow_id: workflowId, type: 'none' })
  }

  return Response.json(formatTriggerResponse(trigger))
}

export async function updateWorkflowTrigger(user: User, workflowId: number, body: any) {
  const workflow = await getWorkflowById(workflowId)

  if (!workflow || workflow.creator_user_id !== user.id) {
    return notFoundResponse('Workflow not found')
  }

  if (!body.type || typeof body.type !== 'string') {
    return badRequestResponse('Trigger type is required')
  }

  await deleteTriggersByWorkflowId(workflowId)

  if (body.type !== 'none') {
    const configToken = await getActiveConfigToken()
    if (configToken) {
      const manifest = generateManifest(workflow.name, body.type)
      try {
        await slack.apps.manifest.update({
          token: configToken,
          app_id: workflow.app_id,
          manifest,
        })
      } catch (e) {
        console.error('Failed to update manifest:', e)
      }
    }

    const base = {
      execution_id: null,
      workflow_id: workflowId,
      details: null,
    }

    if (body.type === 'cron') {
      if (!body.schedule) {
        return badRequestResponse('Cron trigger requires schedule field')
      }
      await createCronTrigger(body.schedule, {
        ...base,
        func: 'workflow.execute.cron',
      })
    } else if (body.type === 'message') {
      if (!body.channel_id) {
        return badRequestResponse('Message trigger requires channel_id field')
      }
      await createMessageTrigger(body.channel_id, {
        ...base,
        func: 'workflow.execute.message',
      })
    } else if (body.type === 'reaction') {
      if (!body.channel_id || !body.emoji) {
        return badRequestResponse('Reaction trigger requires channel_id and emoji fields')
      }
      await createReactionTrigger(body.channel_id, body.emoji, {
        ...base,
        func: 'workflow.execute.reaction',
      })
    } else if (body.type === 'member_join') {
      if (!body.channel_id) {
        return badRequestResponse('Member join trigger requires channel_id field')
      }
      await createMemberJoinTrigger(body.channel_id, {
        ...base,
        func: 'workflow.execute.member_join',
      })
    } else {
      return badRequestResponse('Invalid trigger type')
    }
  }

  const trigger = await getWorkflowTrigger(workflowId)

  if (!trigger) {
    return Response.json({ workflow_id: workflowId, type: 'none' })
  }

  return Response.json(formatTriggerResponse(trigger))
}

export async function deleteWorkflowTrigger(user: User, workflowId: number) {
  const workflow = await getWorkflowById(workflowId)

  if (!workflow || workflow.creator_user_id !== user.id) {
    return notFoundResponse('Workflow not found')
  }

  await deleteTriggersByWorkflowId(workflowId)

  return new Response(null, { status: 204 })
}
