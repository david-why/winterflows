import type {
  BlockElementAction,
  SlackAction,
  SlackViewAction,
  ViewStateValue,
} from '@slack/bolt'
import slack from '../clients/slack'
import {
  getWorkflowById,
  updateWorkflow,
  type Workflow,
} from '../database/workflows'
import { generateRandomId } from '../utils/formatting'
import { getWorkflowSteps } from '../utils/workflows'
import { generateStepEditView, updateHomeTab } from './blocks'
import { startWorkflow, type WorkflowStep } from './execute'
import stepSpecs, { type WorkflowStepMap } from './steps'

export async function handleInteraction(
  interaction: SlackAction | SlackViewAction
) {
  if (interaction.type === 'block_actions') {
    console.log(interaction)
    const action = interaction.actions[0]
    if (!action) return
    const actionId = action.action_id

    if (
      actionId.startsWith('update_input:') ||
      actionId.startsWith('update_category:')
    ) {
      const [, workflowId, stepId, inputKey] = actionId.split(':')

      const workflow = await getWorkflowById(parseInt(workflowId!))
      if (!workflow || !workflow.access_token) return

      const value = JSON.parse(getValue(action))
      await updateWorkflowStepInput(workflow, stepId!, inputKey!, value)

      console.log(interaction.view?.state.values)

      const currentState: Record<string, any> = {}
      for (const block of Object.values(interaction.view?.state.values || {})) {
        for (const [actionId, value] of Object.entries(block)) {
          if (!actionId.startsWith('update_input:')) continue
          currentState[actionId] = getInitialValueFromState(value)
        }
      }

      await Promise.all([
        slack.views.update({
          token: workflow.access_token,
          view_id: interaction.view!.id,
          view: await generateStepEditView(workflow, stepId!, currentState),
        }),
        updateHomeTab(workflow, interaction.user.id),
      ])
    } else if (actionId === 'run_workflow_home') {
      if (action.type !== 'button') return

      const { id } = JSON.parse(action.value!) as { id: number }
      const workflow = await getWorkflowById(id)
      if (!workflow) return

      await startWorkflow(workflow, interaction.user.id)
    } else if (actionId === 'edit_step') {
      if (action.type !== 'button') return

      const { workflowId, stepId } = JSON.parse(action.value!) as {
        workflowId: number
        stepId: string
      }
      const workflow = await getWorkflowById(workflowId)
      if (!workflow || !workflow.access_token) return

      await slack.views.open({
        token: workflow.access_token,
        trigger_id: interaction.trigger_id,
        view: await generateStepEditView(workflow, stepId),
      })
    } else if (actionId === 'new_step') {
      if (action.type !== 'static_select') return

      const { w: id, s: stepId } = JSON.parse(action.selected_option.value) as {
        w: number
        s: string
      }
      const spec = stepSpecs[stepId as keyof WorkflowStepMap]
      if (!spec) return

      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return

      const inputs: Record<string, string> = {}
      for (const key in spec.inputs) {
        inputs[key] = ''
      }

      const step: WorkflowStep<any> = {
        id: generateRandomId(),
        type_id: stepId,
        inputs,
      }
      const steps = getWorkflowSteps(workflow)
      steps.push(step)
      workflow.steps = JSON.stringify(steps)
      await updateWorkflow(workflow)

      await updateHomeTab(workflow, interaction.user.id)
    }
  } else if (interaction.type === 'view_submission') {
    if (interaction.view.callback_id === 'step_edit') {
      console.log(interaction)
      console.log(interaction.view.state.values)

      const { id, stepId } = JSON.parse(interaction.view.private_metadata) as {
        id: number
        stepId: string
      }
      const workflow = await getWorkflowById(id)
      if (!workflow) return

      for (const block of Object.values(interaction.view.state.values)) {
        for (const [actionId, state] of Object.entries(block)) {
          console.log(actionId, state)
          if (!actionId.startsWith('update_input:')) continue
          const value = getValueFromState(state)
          if (!value) continue
          const [, , , inputKey] = actionId.split(':')
          await updateWorkflowStepInput(
            workflow,
            stepId!,
            inputKey!,
            JSON.parse(value)
          )
        }
      }

      await updateHomeTab(workflow, interaction.user.id)
    }
  }
}

async function updateWorkflowStepInput(
  workflow: Workflow,
  stepId: string,
  inputKey: string,
  value: any
) {
  console.log('update', stepId, inputKey, value)
  const steps = getWorkflowSteps(workflow)
  const stepIndex = steps.findIndex((s) => s.id === stepId)
  if (stepIndex < 0) return
  const step = steps[stepIndex]!

  if (value.type === 'text') {
    step.inputs[inputKey!] = value.text
  } else if (value.type === 'custom') {
    step.inputs[inputKey!] = ''
  }

  workflow.steps = JSON.stringify(steps)
  await updateWorkflow(workflow)
}

function getValueFromState(action: ViewStateValue) {
  switch (action.type) {
    case 'users_select':
      if (!action.selected_user) return
      return JSON.stringify({ type: 'text', text: action.selected_user })
    case 'conversations_select':
      if (!action.selected_conversation) return
      return JSON.stringify({
        type: 'text',
        text: action.selected_conversation,
      })
    case 'rich_text_input':
      if (!action.rich_text_value) return
      return JSON.stringify({
        type: 'text',
        text: JSON.stringify(action.rich_text_value),
      })
  }
}

function getValue(action: BlockElementAction) {
  switch (action.type) {
    case 'static_select':
      return action.selected_option.value
    case 'users_select':
      return JSON.stringify({ type: 'text', text: action.selected_user })
    case 'conversations_select':
      return JSON.stringify({
        type: 'text',
        text: action.selected_conversation,
      })
    case 'rich_text_input':
      return JSON.stringify({
        type: 'text',
        text: JSON.stringify(action.rich_text_value),
      })
    default:
      return ''
  }
}

function getInitialValueFromState(action: ViewStateValue): any {
  switch (action.type) {
    case 'users_select':
      return action.selected_user
    case 'conversations_select':
      return action.selected_conversation
    case 'rich_text_input':
      return action.rich_text_value
  }
}
