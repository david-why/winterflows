import type { User } from '../database/users'
import {
  getWorkflowById,
} from '../database/workflows'
import {
  getWorkflowExecutionById,
  updateWorkflowExecution,
  type WorkflowExecution,
} from '../database/workflow_executions'
import { notFoundResponse, badRequestResponse, conflictResponse } from './auth'
import { sql } from 'bun'

function formatExecutionSummary(execution: WorkflowExecution) {
  const steps = JSON.parse(execution.steps || '[]')
  const totalSteps = steps.length
  const isDone = execution.step_index >= totalSteps

  return {
    id: execution.id,
    workflow_id: execution.workflow_id,
    trigger_user_id: execution.trigger_user_id,
    status: isDone ? 'completed' : 'running',
    started_at: new Date(execution.id * 100000).toISOString(),
    current_step: execution.step_index,
    total_steps: totalSteps,
    trigger_type: execution.trigger_id ? 'automatic' : 'manual',
  }
}

function formatExecutionDetail(execution: WorkflowExecution, workflowName: string) {
  const steps = JSON.parse(execution.steps || '[]')
  const state = JSON.parse(execution.state || '{}')
  const totalSteps = steps.length
  const isDone = execution.step_index >= totalSteps

  const formattedSteps = steps.map((step: any, idx: number) => ({
    id: step.id,
    type_id: step.type_id,
    status: idx < execution.step_index ? 'completed' : idx === execution.step_index ? 'running' : 'pending',
    output: state.outputs?.[step.id],
  }))

  return {
    id: execution.id,
    workflow_id: execution.workflow_id,
    workflow_name: workflowName,
    trigger_user_id: execution.trigger_user_id,
    status: isDone ? 'completed' : 'running',
    started_at: new Date(execution.id * 100000).toISOString(),
    trigger_type: execution.trigger_id ? 'automatic' : 'manual',
    steps: formattedSteps,
    context: state.additionalCtx || {},
    outputs: state.outputs || {},
  }
}

export async function listWorkflowExecutions(user: User, workflowId: number, searchParams: URLSearchParams) {
  const workflow = await getWorkflowById(workflowId)

  if (!workflow || workflow.creator_user_id !== user.id) {
    return notFoundResponse('Workflow not found')
  }

  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
  const offset = parseInt(searchParams.get('offset') || '0')
  const status = searchParams.get('status')

  let query = sql`SELECT * FROM workflow_executions WHERE workflow_id = ${workflowId}`

  if (status) {
    if (status === 'running') {
      query = sql`SELECT * FROM workflow_executions WHERE workflow_id = ${workflowId} 
        AND step_index < json_array_length(steps)`
    } else if (status === 'completed') {
      query = sql`SELECT * FROM workflow_executions WHERE workflow_id = ${workflowId} 
        AND step_index >= json_array_length(steps)`
    }
  }

  const allExecutions = await query
  const total = allExecutions.length
  const executions = allExecutions.slice(offset, offset + limit)

  const formattedExecutions = executions.map(formatExecutionSummary)

  return Response.json({
    executions: formattedExecutions,
    total,
    limit,
    offset,
    has_more: offset + limit < total,
  })
}

export async function getExecution(user: User, executionId: number) {
  const execution = await getWorkflowExecutionById(executionId)

  if (!execution) {
    return notFoundResponse('Execution not found')
  }

  const workflow = await getWorkflowById(execution.workflow_id)

  if (!workflow || workflow.creator_user_id !== user.id) {
    return notFoundResponse('Execution not found')
  }

  return Response.json(formatExecutionDetail(execution, workflow.name))
}

export async function cancelExecution(user: User, executionId: number) {
  const execution = await getWorkflowExecutionById(executionId)

  if (!execution) {
    return notFoundResponse('Execution not found')
  }

  const workflow = await getWorkflowById(execution.workflow_id)

  if (!workflow || workflow.creator_user_id !== user.id) {
    return notFoundResponse('Execution not found')
  }

  const steps = JSON.parse(execution.steps || '[]')
  const isDone = execution.step_index >= steps.length

  if (isDone) {
    return conflictResponse('Execution already completed')
  }

  execution.step_index = steps.length
  await updateWorkflowExecution(execution)

  return Response.json({
    id: execution.id,
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
  })
}
