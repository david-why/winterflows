import type { User } from '../database/users'
import { getWorkflowById } from '../database/workflows'
import { notFoundResponse } from './auth'
import stepSpecs from '../workflows/steps'
import { sql } from 'bun'

export async function listStepTypes() {
  const steps = Object.entries(stepSpecs).map(([typeId, spec]) => ({
    type_id: typeId,
    name: spec.name,
    category: spec.category,
    inputs: Object.entries(spec.inputs).reduce(
      (acc, [key, input]) => {
        acc[key] = {
          type: input.type,
          required: input.required,
          description: input.description || input.name,
        }
        return acc
      },
      {} as Record<string, any>
    ),
    outputs: Object.entries(spec.outputs).reduce(
      (acc, [key, output]) => {
        acc[key] = {
          type: output.type,
          description: output.description || output.name,
        }
        return acc
      },
      {} as Record<string, any>
    ),
  }))

  return Response.json({ steps })
}

export async function getWorkflowStats(user: User, workflowId: number, searchParams: URLSearchParams) {
  const workflow = await getWorkflowById(workflowId)

  if (!workflow || workflow.creator_user_id !== user.id) {
    return notFoundResponse('Workflow not found')
  }

  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = sql`SELECT * FROM workflow_executions WHERE workflow_id = ${workflowId}`

  const executions = await query

  const totalExecutions = executions.length
  let successfulExecutions = 0
  let failedExecutions = 0

  for (const exec of executions) {
    const steps = JSON.parse(exec.steps || '[]')
    const isDone = exec.step_index >= steps.length
    if (isDone) {
      successfulExecutions++
    } else {
      failedExecutions++
    }
  }

  return Response.json({
    workflow_id: workflowId,
    period: {
      from: from || new Date(0).toISOString(),
      to: to || new Date().toISOString(),
    },
    total_executions: totalExecutions,
    successful_executions: successfulExecutions,
    failed_executions: failedExecutions,
    average_duration_ms: 0,
  })
}
