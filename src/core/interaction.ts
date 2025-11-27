import type { SlackAction } from '@slack/bolt'
import { startWorkflow } from '../workflows/execute'
import { getWorkflowById } from '../database/workflows'

export async function handleCoreInteraction(interaction: SlackAction) {
  if (interaction.type === 'block_actions') {
    console.log(interaction)

    const action = interaction.actions[0]
    if (!action) return
    const actionId = action.action_id

    if (actionId === 'run_workflow_home') {
      if (action.type !== 'button') return

      const { id } = JSON.parse(action.value!) as { id: number }
      const workflow = await getWorkflowById(id)
      if (!workflow) return

      await startWorkflow(workflow, interaction.user.id)
    }
  }
}
