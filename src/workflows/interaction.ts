import type {
  BlockElementAction,
  SlackAction,
  SlackViewAction,
  ViewStateValue,
} from '@slack/bolt'
import type { RichTextBlock, SlackEvent } from '@slack/types'
import slack from '../clients/slack'
import {
  getWorkflowById,
  updateWorkflow,
  type Workflow,
} from '../database/workflows'
import { generateRandomId } from '../utils/formatting'
import {
  addTextToRichTextBlock,
  generateManifest,
  getActiveConfigToken,
  respond,
  type ManifestEvent,
} from '../utils/slack'
import { getWorkflowSteps } from '../utils/workflows'
import { generateStepEditView, updateHomeTab } from './blocks'
import { startWorkflow, type WorkflowStep } from './execute'
import stepSpecs, { type WorkflowStepMap } from './steps'
import {
  deleteTriggerById,
  deleteTriggersByWorkflowId,
} from '../database/triggers'
import { createMessageTrigger } from '../triggers/create'
import { registerTriggerFunction } from '../triggers/functions'

export async function handleInteraction(
  interaction: SlackAction | SlackViewAction
) {
  if (interaction.type === 'block_actions') {
    const action = interaction.actions[0]
    if (!action) return
    const actionId = action.action_id

    if (actionId.startsWith('update_category:')) {
      // a select menu for user or channel inputs is edited

      const [, workflowId, stepId, inputKey] = actionId.split(':')

      const workflow = await getWorkflowById(parseInt(workflowId!))
      if (!workflow || !workflow.access_token) return

      const value = JSON.parse(getValue(action))
      await updateWorkflowStepInput(workflow, stepId!, inputKey!, value)

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
      // the "Run workflow" button in the app home is clicked

      if (action.type !== 'button') return

      const { id } = JSON.parse(action.value!) as { id: number }
      const workflow = await getWorkflowById(id)
      if (!workflow) return respond(interaction, 'The workflow is not found!')

      await startWorkflow(workflow, interaction.user.id)
    } else if (actionId === 'manage_step') {
      // the overflow menu to the right of a step on the edit page is clicked

      if (action.type !== 'overflow') return

      const { id } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token)
        return respond(interaction, 'The workflow is not found!')

      const { action: method, id: stepId } = JSON.parse(
        action.selected_option.value
      ) as { action: 'edit' | 'delete'; id: string }

      if (method === 'edit') {
        await slack.views.open({
          token: workflow.access_token,
          trigger_id: interaction.trigger_id,
          view: await generateStepEditView(workflow, stepId),
        })
      } else {
        const steps = getWorkflowSteps(workflow)
        const index = steps.findIndex((s) => s.id === stepId)
        if (index < 0) return
        steps.splice(index, 1)

        workflow.steps = JSON.stringify(steps)
        await updateWorkflow(workflow)

        await updateHomeTab(workflow, interaction.user.id)
      }
    } else if (actionId === 'new_step') {
      // the "Add a step" select menu on the workflow edit page was edited

      if (action.type !== 'static_select') return

      const { id } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
      }
      const stepId = action.selected_option.value
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
    } else if (action.action_id.startsWith('input_token:')) {
      // the "Add token" select menu is used on a workflow step edit menu

      if (action.type !== 'static_select') return

      const [, inputKey] = action.action_id.split(':')
      const { id, stepId } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
        stepId: string
      }

      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token)
        return respond(interaction, 'The workflow is not found!')
      const steps = getWorkflowSteps(workflow)
      const step = steps.find((s) => s.id === stepId)
      if (!step) return respond(interaction, 'The workflow step is not found!')
      const spec = stepSpecs[step.type_id]!
      const input = spec.inputs[inputKey!]!

      const textToAdd = JSON.parse(action.selected_option.value).text as string
      const actionId = `update_input:${workflow.id}:${stepId}:${inputKey}`

      let blockId: string = ''
      for (const [id, values] of Object.entries(
        interaction.view!.state!.values
      )) {
        if (values[actionId]) {
          blockId = id
          break
        }
      }
      const currentValue = getInitialValueFromState(
        interaction.view!.state!.values[blockId]![actionId]!
      )

      if (input.type === 'text') {
        interaction.view!.state!.values[blockId]![actionId]!.value =
          (currentValue || '') + textToAdd
      } else if (input.type === 'rich_text') {
        const block = addTextToRichTextBlock(
          (currentValue as RichTextBlock) || {
            type: 'rich_text',
            elements: [],
          },
          textToAdd
        )
        interaction.view!.state!.values[blockId]![actionId]!.rich_text_value =
          block
        JSON.stringify(block)
      }

      const currentState: Record<string, any> = {}
      for (const block of Object.values(interaction.view?.state.values || {})) {
        for (const [actionId, value] of Object.entries(block)) {
          if (!actionId.startsWith('update_input:')) continue
          currentState[actionId] = getInitialValueFromState(value)
        }
      }

      await slack.views.update({
        token: workflow.access_token,
        view_id: interaction.view!.id,
        view: await generateStepEditView(workflow, stepId!, currentState),
      })
    } else if (action.action_id === 'edit_workflow_trigger') {
      // when the "Edit trigger" button is clicked in workflow app home

      if (action.type !== 'static_select') return

      const trigger_type = action.selected_option.value as 'none' | 'message'

      const { id } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return

      await deleteTriggersByWorkflowId(id)

      const extraEvents: ManifestEvent[] = []
      if (trigger_type === 'message')
        extraEvents.push(
          'message.im',
          'message.channels',
          'message.groups',
          'message.mpim'
        )
      const manifest = generateManifest(workflow.name, extraEvents)
      await slack.apps.manifest.update({
        token: await getActiveConfigToken(),
        app_id: workflow.app_id,
        manifest,
      })

      if (trigger_type === 'message') {
        // FIXME: don't hardcode the channel please
        await createMessageTrigger('C0A158LFGSU', {
          workflow_id: id,
          execution_id: null,
          func: 'workflow.execute.message',
          details: JSON.stringify({}),
        })
      }
    }
  } else if (interaction.type === 'view_submission') {
    if (interaction.view.callback_id === 'step_edit') {
      // a step edit modal was submitted

      const { id, stepId } = JSON.parse(interaction.view.private_metadata) as {
        id: number
        stepId: string
      }
      const workflow = await getWorkflowById(id)
      if (!workflow) return

      for (const block of Object.values(interaction.view.state.values)) {
        for (const [actionId, state] of Object.entries(block)) {
          if (!actionId.startsWith('update_input:')) continue
          const value = getValueFromState(state)
          if (!value) continue
          const [, , , inputKey] = actionId.split(':')
          await updateWorkflowStepInput(workflow, stepId!, inputKey!, value)
        }
      }

      await updateHomeTab(workflow, interaction.user.id)
    }
  }
}

registerTriggerFunction(
  'workflow.execute.message',
  async (trigger, message: SlackEvent & { type: 'message' }) => {
    const workflow = await getWorkflowById(trigger.workflow_id!)
    if (!workflow) return deleteTriggerById(trigger.id)
    await startWorkflow(workflow, workflow.creator_user_id, {
      'trigger.message': JSON.stringify({
        channel: message.channel,
        ts: message.ts,
      }),
    })
  }
)

async function updateWorkflowStepInput(
  workflow: Workflow,
  stepId: string,
  inputKey: string,
  value: any
) {
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
      return { type: 'text', text: action.selected_user }
    case 'conversations_select':
      if (!action.selected_conversation) return
      return {
        type: 'text',
        text: action.selected_conversation,
      }
    case 'rich_text_input':
      if (!action.rich_text_value) return
      return {
        type: 'text',
        text: JSON.stringify(action.rich_text_value),
      }
    case 'plain_text_input':
      if (!action.value) return
      return { type: 'text', text: action.value }
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
    case 'plain_text_input':
      return JSON.stringify({
        type: 'text',
        text: JSON.stringify(action.value),
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
    case 'plain_text_input':
      return action.value
  }
}
