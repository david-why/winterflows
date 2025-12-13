import type { User } from '../database/users'
import {
  getWorkflowById,
  getWorkflowsByCreator,
  addWorkflow,
  updateWorkflow,
  deleteWorkflowById,
  type Workflow,
} from '../database/workflows'
import {
  getWorkflowTrigger,
  deleteTriggersByWorkflowId,
} from '../database/triggers'
import { getWorkflowSteps } from '../utils/workflows'
import {
  notFoundResponse,
  badRequestResponse,
  validationErrorResponse,
  conflictResponse,
} from './auth'
import { generateManifest, getActiveConfigToken } from '../utils/slack'
import slack from '../clients/slack'
import { createCronTrigger, createMemberJoinTrigger, createMessageTrigger, createReactionTrigger } from '../triggers/create'
import { sql } from 'bun'

function formatWorkflowSummary(workflow: Workflow, trigger: any) {
  const steps = JSON.parse(workflow.steps || '[]')
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    created_at: new Date(workflow.id * 100000).toISOString(),
    is_installed: !!workflow.access_token,
    trigger: trigger ? formatTriggerResponse(trigger) : { type: 'none' },
    step_count: steps.length,
  }
}

function formatWorkflowDetail(workflow: Workflow, trigger: any) {
  const steps = JSON.parse(workflow.steps || '[]')
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    creator_user_id: workflow.creator_user_id,
    app_id: workflow.app_id,
    is_installed: !!workflow.access_token,
    created_at: new Date(workflow.id * 100000).toISOString(),
    trigger: trigger ? formatTriggerResponse(trigger) : { type: 'none' },
    steps,
  }
}

function formatTriggerResponse(trigger: any) {
  const base = { type: trigger.type }

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

export async function listWorkflows(user: User, searchParams: URLSearchParams) {
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
  const offset = parseInt(searchParams.get('offset') || '0')
  const sort = searchParams.get('sort') || 'created_desc'

  let workflows = await getWorkflowsByCreator(user.id)

  if (sort === 'created_asc') {
    workflows.sort((a, b) => a.id - b.id)
  } else if (sort === 'name_asc') {
    workflows.sort((a, b) => a.name.localeCompare(b.name))
  } else if (sort === 'name_desc') {
    workflows.sort((a, b) => b.name.localeCompare(a.name))
  }

  const total = workflows.length
  workflows = workflows.slice(offset, offset + limit)

  const triggers = await sql`SELECT * FROM triggers WHERE workflow_id = ANY(${workflows.map(w => w.id)})`
  const triggerMap = new Map(triggers.map((t: any) => [t.workflow_id, t]))

  const formattedWorkflows = workflows.map(w =>
    formatWorkflowSummary(w, triggerMap.get(w.id))
  )

  return Response.json({
    workflows: formattedWorkflows,
    total,
    limit,
    offset,
    has_more: offset + limit < total,
  })
}

export async function getWorkflow(user: User, id: number) {
  const workflow = await getWorkflowById(id)

  if (!workflow || workflow.creator_user_id !== user.id) {
    return notFoundResponse('Workflow not found')
  }

  const trigger = await getWorkflowTrigger(workflow.id)

  return Response.json(formatWorkflowDetail(workflow, trigger))
}

export async function createWorkflow(user: User, body: any) {
  if (!body.name || typeof body.name !== 'string') {
    return badRequestResponse('Workflow name is required')
  }

  const configToken = await getActiveConfigToken()
  if (!configToken) {
    return badRequestResponse('System configuration unavailable')
  }

  const triggerType = body.trigger?.type || 'none'
  const manifest = generateManifest(body.name, triggerType === 'none' ? undefined : triggerType)

  let app
  try {
    app = await slack.apps.manifest.create({
      token: configToken,
      manifest,
    })
  } catch (e) {
    console.error('Failed to create app:', e)
    return badRequestResponse('Failed to create Slack app')
  }

  const workflow = await addWorkflow({
    name: body.name,
    creator_user_id: user.id,
    app_id: app.app_id!,
    client_id: app.credentials!.client_id!,
    client_secret: app.credentials!.client_secret!,
    signing_secret: app.credentials!.signing_secret!,
    access_token: null,
  })

  workflow.description = body.description || 'A brand new workflow'

  if (body.steps && Array.isArray(body.steps)) {
    workflow.steps = JSON.stringify(body.steps)
    await updateWorkflow(workflow)
  }

  if (body.trigger && body.trigger.type !== 'none') {
    await createTriggerFromSpec(workflow.id, body.trigger)
  }

  const trigger = await getWorkflowTrigger(workflow.id)

  const url = new URL(app.oauth_authorize_url!)
  url.searchParams.set('state', app.app_id!)

  return Response.json(
    {
      ...formatWorkflowDetail(workflow, trigger),
      installation_url: url.toString(),
    },
    { status: 201 }
  )
}

export async function patchWorkflow(user: User, id: number, body: any) {
  const workflow = await getWorkflowById(id)

  if (!workflow || workflow.creator_user_id !== user.id) {
    return notFoundResponse('Workflow not found')
  }

  if (body.name !== undefined) {
    workflow.name = body.name
  }
  if (body.description !== undefined) {
    workflow.description = body.description
  }
  if (body.steps !== undefined) {
    if (!Array.isArray(body.steps)) {
      return badRequestResponse('Steps must be an array')
    }
    workflow.steps = JSON.stringify(body.steps)
  }

  await updateWorkflow(workflow)

  if (body.trigger !== undefined) {
    await deleteTriggersByWorkflowId(workflow.id)

    if (body.trigger.type && body.trigger.type !== 'none') {
      const configToken = await getActiveConfigToken()
      if (configToken) {
        const manifest = generateManifest(workflow.name, body.trigger.type)
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

      await createTriggerFromSpec(workflow.id, body.trigger)
    }
  }

  const trigger = await getWorkflowTrigger(workflow.id)

  return Response.json(formatWorkflowDetail(workflow, trigger))
}

export async function deleteWorkflow(user: User, id: number, searchParams: URLSearchParams) {
  const workflow = await getWorkflowById(id)

  if (!workflow || workflow.creator_user_id !== user.id) {
    return notFoundResponse('Workflow not found')
  }

  const force = searchParams.get('force') === 'true'

  if (!force) {
    const runningExecutions = await sql`
      SELECT COUNT(*) as count FROM workflow_executions 
      WHERE workflow_id = ${id} AND step_index < (
        SELECT json_array_length(steps) FROM workflow_executions WHERE id = workflow_executions.id
      )
    `

    if (runningExecutions[0]?.count > 0) {
      return conflictResponse('Cannot delete workflow with active executions')
    }
  }

  await deleteWorkflowById(id)

  return new Response(null, { status: 204 })
}

async function createTriggerFromSpec(workflowId: number, triggerSpec: any) {
  const base = {
    execution_id: null,
    workflow_id: workflowId,
    details: null,
  }

  if (triggerSpec.type === 'cron') {
    await createCronTrigger(triggerSpec.schedule, {
      ...base,
      func: 'workflow.execute.cron',
    })
  } else if (triggerSpec.type === 'message') {
    await createMessageTrigger(triggerSpec.channel_id, {
      ...base,
      func: 'workflow.execute.message',
    })
  } else if (triggerSpec.type === 'reaction') {
    await createReactionTrigger(triggerSpec.channel_id, triggerSpec.emoji, {
      ...base,
      func: 'workflow.execute.reaction',
    })
  } else if (triggerSpec.type === 'member_join') {
    await createMemberJoinTrigger(triggerSpec.channel_id, {
      ...base,
      func: 'workflow.execute.member_join',
    })
  }
}
