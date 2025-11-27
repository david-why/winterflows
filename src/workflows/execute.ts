import {
  addWorkflowExecution,
  deleteWorkflowExecutionById,
  updateWorkflowExecution,
  type WorkflowExecution,
} from '../database/workflow_executions'
import { getWorkflowById, type Workflow } from '../database/workflows'
import { getWorkflowSteps } from '../utils/workflows'
import type { ExecutionContext } from './context'
import type { WorkflowStepMap } from './steps'
import stepSpecs from './steps'

export interface WorkflowStep<Type extends keyof WorkflowStepMap> {
  id: string
  type_id: Type
  inputs: {
    [K in keyof WorkflowStepMap[Type]['inputs']]: string
  }
}

export interface ExecutionState {
  trigger_user_id: string
  outputs: Record<string, string>
}

export async function startWorkflow(workflow: Workflow, user: string) {
  if (!workflow.access_token) return

  const execution = await addWorkflowExecution({
    workflow_id: workflow.id,
    steps: workflow.steps,
    state: JSON.stringify({
      trigger_user_id: user,
      outputs: {},
    } satisfies ExecutionState),
  })

  await proceedWorkflow(execution)
}

export async function proceedWorkflow(execution: WorkflowExecution) {
  const workflow = await getWorkflowById(execution.workflow_id)
  if (!workflow) {
    await deleteWorkflowExecutionById(execution.id)
    return
  }

  const steps = getWorkflowSteps(execution)

  if (execution.step_index >= steps.length) {
    // workflow done
    await deleteWorkflowExecutionById(execution.id)
    return
  }

  const state = JSON.parse(execution.state) as ExecutionState
  const step = steps[execution.step_index]!
  const spec = stepSpecs[step.type_id as keyof WorkflowStepMap]

  const replacements: Record<string, string> = {
    'ctx.trigger_user_id': state.trigger_user_id,
  }
  for (const [key, value] of Object.entries(state.outputs)) {
    replacements[`outputs.${key}`] = value
  }

  const inputs: Record<string, string> = {}
  for (const key in spec.inputs) {
    let value = step.inputs[key]!
    for (const [old, replacement] of Object.entries(replacements)) {
      value = value.replace(`$!{${old}}`, replacement)
    }
    inputs[key] = value
  }

  const ctx: ExecutionContext = {
    trigger_user_id: state.trigger_user_id,
    token: workflow.access_token!,
    workflow,
  }
  const outputs = await spec.func(ctx, inputs as any)
  for (const [key, value] of Object.entries(outputs)) {
    state.outputs[`${step.id}.${key}`] = value
  }

  execution.step_index++
  execution.state = JSON.stringify(state)
  await updateWorkflowExecution(execution)

  proceedWorkflow(execution)
}
