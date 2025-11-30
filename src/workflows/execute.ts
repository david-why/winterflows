import slack from '../clients/slack'
import {
  addWorkflowExecution,
  deleteWorkflowExecutionById,
  getWorkflowExecutionById,
  updateWorkflowExecution,
  type WorkflowExecution,
} from '../database/workflow_executions'
import { getWorkflowById, type Workflow } from '../database/workflows'
import { replaceRichText, replaceText } from '../utils/slack'
import { getWorkflowSteps } from '../utils/workflows'
import type { ExecutionContext } from './context'
import type { WorkflowStepMap } from './steps'
import stepSpecs, { PENDING } from './steps'

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!

export interface WorkflowStep<Type extends keyof WorkflowStepMap> {
  id: string
  type_id: Type
  inputs: {
    [K in keyof WorkflowStepMap[Type]['inputs']]: string
  }
}

export interface ExecutionState {
  outputs: Record<string, string>
  additionalCtx: Record<string, string>
}

export async function startWorkflow(
  workflow: Workflow,
  user: string,
  additionalCtx: Record<string, string> = {}
) {
  if (!workflow.access_token) return

  console.log(`Workflow ${workflow.id} started by ${user}`)

  const execution = await addWorkflowExecution({
    workflow_id: workflow.id,
    trigger_user_id: user,
    steps: workflow.steps,
    state: JSON.stringify({
      outputs: {},
      additionalCtx,
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
    return
  }

  try {
    const state = JSON.parse(execution.state) as ExecutionState
    const step = steps[execution.step_index]!
    const spec = stepSpecs[step.type_id as keyof WorkflowStepMap]
    if (!spec) {
      throw new Error(`Step \`${step.type_id}\` not found`)
    }

    const replacements: Record<string, string> = {
      '$!{ctx.trigger_user_id}': execution.trigger_user_id,
      '$!{ctx.trigger_user_ping}': `<@${execution.trigger_user_id}>`,
    }
    for (const [key, value] of Object.entries(state.outputs)) {
      replacements[`$!{outputs.${key}}`] = value
    }
    for (const [key, value] of Object.entries(state.additionalCtx)) {
      replacements[`$!{${key}}`] = value
    }

    const inputs: Record<string, string> = {}
    for (const [key, inputSpec] of Object.entries(spec.inputs)) {
      let value = step.inputs[key]!
      if (inputSpec.type === 'rich_text') {
        value =
          value &&
          JSON.stringify(replaceRichText(JSON.parse(value), replacements))
      } else {
        value = replaceText(value, replacements)
      }
      inputs[key] = value
    }

    const ctx: ExecutionContext = {
      execution,
      step_id: step.id,
      trigger_user_id: execution.trigger_user_id,
      token: workflow.access_token!,
      workflow,
    }

    const outputs = await spec.func(ctx, inputs as any)
    if (outputs === PENDING) return
    await advanceWorkflow(execution.id, step.id, outputs)
  } catch (e) {
    console.error('Error occurred when executing workflow', e)
    await slack.chat.postMessage({
      token: SLACK_BOT_TOKEN,
      channel: execution.trigger_user_id,
      text: `A workflow (\`${
        workflow.name
      }\`) finished with an error. Please review the following error information.\n\n\`\`\`\n${String(
        e
      )}\n\`\`\``,
    })
  }
}

export async function advanceWorkflow(
  executionId: number,
  stepId: string,
  outputs: Record<string, string>
) {
  const execution = await getWorkflowExecutionById(executionId)
  if (!execution) return
  const steps = getWorkflowSteps(execution)

  const stepIndex = steps.findIndex((s) => s.id === stepId)
  if (stepIndex !== execution.step_index) {
    console.warn(
      `Workflow execution ${execution.id} repeated step #${stepIndex}`
    )
    return
  }

  // actually advance

  const state = JSON.parse(execution.state) as ExecutionState

  for (const [key, value] of Object.entries(outputs)) {
    state.outputs[`${stepId}.${key}`] = value
  }

  execution.step_index++
  execution.state = JSON.stringify(state)
  await updateWorkflowExecution(execution)

  proceedWorkflow(execution)
}
