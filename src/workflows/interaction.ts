import type { BlockElementAction, SlackAction } from '@slack/bolt'
import { getWorkflowById, updateWorkflow } from '../database/workflows'
import { getWorkflowSteps } from '../utils/workflows'
import { updateHomeTab } from './blocks'
import { startWorkflow } from './execute'

export async function handleInteraction(interaction: SlackAction) {
  if (interaction.type === 'block_actions') {
    console.log(interaction)
    const action = interaction.actions[0]
    if (!action) return
    const actionId = action.action_id

    if (actionId.startsWith('update_input:')) {
      const [, workflowId, stepId, inputKey] = actionId.split(':')

      const workflow = await getWorkflowById(parseInt(workflowId!))
      if (!workflow) return

      const steps = getWorkflowSteps(workflow)
      const step = steps.find((s) => s.id === stepId)
      if (!step) return

      step.inputs[inputKey!] = getValue(action)

      workflow.steps = JSON.stringify(steps)
      await updateWorkflow(workflow)

      await updateHomeTab(workflow, interaction.user.id)
    } else if (actionId === 'run_workflow_home') {
      if (action.type !== 'button') return

      const { id } = JSON.parse(action.value!) as { id: number }
      const workflow = await getWorkflowById(id)
      if (!workflow) return

      await startWorkflow(workflow, interaction.user.id)
    }
  }
}

function getValue(action: BlockElementAction) {
  switch (action.type) {
    case 'static_select':
      return action.selected_option.value
    default:
      return ''
  }
}
