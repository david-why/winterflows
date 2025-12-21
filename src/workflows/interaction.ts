import type {
  BlockElementAction,
  BlockSuggestion,
  SlackAction,
  SlackViewAction,
  ViewStateValue,
} from '@slack/bolt'
import type {
  KnownBlock,
  MemberJoinedChannelEvent,
  RichTextBlock,
  SlackEvent,
} from '@slack/types'
import slack from '../clients/slack'
import {
  getWorkflowById,
  updateWorkflow,
  type Workflow,
} from '../database/workflows'
import { generateRandomId, truncateText } from '../utils/formatting'
import {
  addTextToRichTextBlock,
  generateManifest,
  getActiveConfigToken,
  respond,
  setAppPhoto,
} from '../utils/slack'
import { getWorkflowSteps } from '../utils/workflows'
import {
  generateStepBranchView,
  generateStepEditView,
  generateWorkflowDetailsView,
  updateHomeTab,
} from './blocks'
import { advanceWorkflow, startWorkflow, type WorkflowStep } from './execute'
import stepSpecs, { type WorkflowStepMap } from './steps'
import {
  deleteTriggerById,
  deleteTriggersByWorkflowId,
  getTriggersByTypeAndString,
  getTriggersWhere,
  getWorkflowTrigger,
  updateTrigger,
  type Trigger,
} from '../database/triggers'
import {
  createCronTrigger,
  createMemberJoinTrigger,
  createMessageTrigger,
  createReactionTrigger,
} from '../triggers/create'
import {
  executeTriggerFunction,
  registerTriggerFunction,
} from '../triggers/functions'
import { sql } from 'bun'
import { validateCron } from '../utils/cron'
import { createWorkflowCanvas, deleteWorkflowCanvas } from './canvas'

export async function handleInteraction(
  interaction: SlackAction | SlackViewAction | BlockSuggestion
) {
  if (interaction.type === 'block_suggestion') {
    return handleDynamicInputs(interaction)
  } else {
    handleInteractionInner(interaction)
    return new Response()
  }
}

async function handleInteractionInner(
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

      await startWorkflow(
        workflow,
        interaction.user.id,
        undefined,
        interaction.trigger_id
      )
    } else if (actionId === 'edit_workflow_details') {
      const { id } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token)
        return respond(interaction, 'The workflow is not found!')

      await slack.views.open({
        token: workflow.access_token,
        trigger_id: interaction.trigger_id,
        view: await generateWorkflowDetailsView(workflow),
      })
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
      ) as { action: 'edit' | 'delete' | 'branch' | 'up' | 'down'; id: string }

      if (method === 'edit') {
        await slack.views.open({
          token: workflow.access_token,
          trigger_id: interaction.trigger_id,
          view: await generateStepEditView(workflow, stepId),
        })
      } else if (method === 'delete') {
        const steps = getWorkflowSteps(workflow)
        const index = steps.findIndex((s) => s.id === stepId)
        if (index < 0) return
        steps.splice(index, 1)

        workflow.steps = JSON.stringify(steps)
        await updateWorkflow(workflow)

        await updateHomeTab(workflow, interaction.user.id)
      } else if (method === 'branch') {
        await slack.views.open({
          token: workflow.access_token,
          trigger_id: interaction.trigger_id,
          view: await generateStepBranchView(workflow, stepId),
        })
      } else if (method === 'up') {
        const steps = getWorkflowSteps(workflow)
        const index = steps.findIndex((s) => s.id === stepId)
        if (index <= 0) return
        const step = steps.splice(index, 1)[0]!
        steps.splice(index - 1, 0, step)

        workflow.steps = JSON.stringify(steps)
        await updateWorkflow(workflow)

        await updateHomeTab(workflow, interaction.user.id)
      } else if (method === 'down') {
        const steps = getWorkflowSteps(workflow)
        const index = steps.findIndex((s) => s.id === stepId)
        if (index < 0 || index === steps.length - 1) return
        const step = steps.splice(index, 1)[0]!
        steps.splice(index + 1, 0, step)

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

      const triggerType = action.selected_option.value as
        | 'none'
        | 'message'
        | 'reaction'
        | 'cron'
        | 'member_join'

      const { id } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return

      await deleteTriggersByWorkflowId(id)

      const manifest = generateManifest(workflow.name, triggerType)
      await slack.apps.manifest.update({
        token: await getActiveConfigToken(),
        app_id: workflow.app_id,
        manifest,
      })

      if (triggerType === 'message') {
        await createMessageTrigger('', {
          workflow_id: id,
          execution_id: null,
          func: 'workflow.execute.message',
          details: JSON.stringify({}),
        })
      } else if (triggerType === 'reaction') {
        await createReactionTrigger('', '', {
          workflow_id: id,
          execution_id: null,
          func: 'workflow.execute.reaction',
          details: JSON.stringify({}),
        })
      } else if (triggerType === 'cron') {
        await createCronTrigger('', {
          workflow_id: id,
          execution_id: null,
          func: 'workflow.execute.cron',
          details: JSON.stringify({}),
        })
      } else if (triggerType === 'member_join') {
        await createMemberJoinTrigger('', {
          workflow_id: id,
          execution_id: null,
          func: 'workflow.execute.member_join',
          details: JSON.stringify({}),
        })
      }

      await updateHomeTab(workflow, interaction.user.id)
    } else if (action.action_id === 'workflow_trigger_message_update') {
      // the channel dropdown is edited when trigger == "Message" on app home

      if (action.type !== 'conversations_select') return

      const { id } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return

      const trigger = (await getTriggersWhere(sql`workflow_id = ${id}`))[0]
      if (trigger?.type !== 'message') return

      await updateTriggerAndJoin(
        interaction,
        workflow,
        trigger,
        action.selected_conversation,
        action.selected_conversation
      )
    } else if (
      action.action_id === 'workflow_trigger_reaction_update_channel'
    ) {
      // the channel dropdown is edited when trigger == "Reaction" on app home

      if (action.type !== 'conversations_select') return

      const { id } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return

      const trigger = (
        await getTriggersWhere(sql`workflow_id = ${workflow.id}`)
      )[0]
      if (trigger?.type !== 'reaction') return

      await updateTriggerAndJoin(
        interaction,
        workflow,
        trigger,
        `${action.selected_conversation}|${trigger.val_string?.split('|')[1]}`,
        action.selected_conversation
      )
    } else if (action.action_id === 'workflow_trigger_reaction_update_emoji') {
      // the emoji field is edited when trigger == "Reaction" on app home

      if (action.type !== 'plain_text_input') return

      const { id } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return

      const trigger = (await getTriggersWhere(sql`workflow_id = ${id}`))[0]
      if (trigger?.type !== 'reaction') return

      trigger.val_string = `${trigger.val_string?.split('|')[0]}|${
        action.value
      }`
      await updateTrigger(trigger)

      await updateHomeTab(workflow, interaction.user.id)
    } else if (action.action_id === 'workflow_trigger_cron_update') {
      // the cron expression is edited when trigger == "Cron" on app home
      if (action.type !== 'plain_text_input') return

      const { id } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return

      const trigger = (await getTriggersWhere(sql`workflow_id = ${id}`))[0]
      if (trigger?.type !== 'cron') return

      const triggerBlocks: KnownBlock[] = []

      const val = validateCron(action.value)
      if (!val.ok) {
        triggerBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Cron expression is invalid: ${val.message}`,
          },
        })
      } else {
        triggerBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Next execution is: <!date^${Math.floor(
              val.next! / 1000
            )}^{date_short_pretty} at {time_secs}|${val.next}>`,
          },
        })
        trigger.val_string = action.value
        await updateTrigger(trigger)
      }

      await updateHomeTab(workflow, interaction.user.id, {
        triggerBlocks,
      })
    } else if (action.action_id === 'workflow_trigger_member_join_update') {
      // the channel dropdown is edited when trigger == "User joined channel" on app home

      if (action.type !== 'conversations_select') return

      const { id } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return

      const trigger = (await getTriggersWhere(sql`workflow_id = ${id}`))[0]
      if (trigger?.type !== 'member_join') return

      await updateTriggerAndJoin(
        interaction,
        workflow,
        trigger,
        action.selected_conversation,
        action.selected_conversation
      )
    } else if (
      action.action_id === 'step_branch_left_token' ||
      action.action_id === 'step_branch_right_token'
    ) {
      // a token is added in the LHS/RHS of the branch edit modal

      if (action.type !== 'static_select') return

      const { id, stepId } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
        stepId: string
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return
      const steps = getWorkflowSteps(workflow)
      const step = steps.find((s) => s.id === stepId)
      if (!step) return

      const key =
        action.action_id === 'step_branch_left_token' ? 'left' : 'right'
      const blockId = key === 'left' ? 'step_branch_left' : 'step_branch_right'
      let value = ''

      for (const [id, values] of Object.entries(
        interaction.view!.state.values
      )) {
        if (id.startsWith(blockId)) {
          value = Object.values(values)[0]!.value! || ''
          break
        }
      }

      value += JSON.parse(action.selected_option.value).text as string

      await slack.views.update({
        token: workflow.access_token,
        view_id: interaction.view!.id,
        view: await generateStepBranchView(workflow, stepId, { [key]: value }),
      })
    } else if (action.action_id === 'step_branch_remove') {
      // the "Remove branching" button is clicked in the edit modal

      if (action.type !== 'button') return

      const { id, stepId } = JSON.parse(interaction.view!.private_metadata) as {
        id: number
        stepId: string
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return
      const steps = getWorkflowSteps(workflow)
      const step = steps.find((s) => s.id === stepId)
      if (!step) return

      step.branching = undefined
      workflow.steps = JSON.stringify(steps)
      await updateWorkflow(workflow)

      updateHomeTab(workflow, interaction.user.id)

      return Response.json({ response_action: 'clear' })
    } else if (action.action_id.startsWith('message_button_')) {
      // a button was pressed on a message sent by a workflow

      if (
        action.type !== 'button' ||
        interaction.container.type !== 'message_attachment'
      )
        return

      const ts = interaction.container.message_ts!
      const channel = interaction.container.channel_id!

      const {
        execution: executionId,
        step,
        value,
      } = JSON.parse(action.value!) as {
        execution: number
        step: string
        value: string
      }

      await advanceWorkflow(
        executionId,
        step,
        {
          message: JSON.stringify({ channel, ts }),
          user: interaction.user.id,
          component: value,
        },
        interaction.trigger_id
      )
    } else if (action.action_id === 'create_workflow_canvas') {
      // the "Create canvas" or "Reset canvas" button on App Home is clicked

      if (action.type !== 'button') return

      const { id } = JSON.parse(action.value!) as { id: number }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return

      await deleteWorkflowCanvas(workflow)
      await createWorkflowCanvas(workflow)
      await updateHomeTab(workflow, interaction.user.id)
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
    } else if (interaction.view.callback_id === 'trigger') {
      // trigger trigger

      const { id } = JSON.parse(interaction.view.private_metadata) as {
        id: string
      }

      const triggers = await getTriggersByTypeAndString('modal', id)

      await Promise.allSettled(
        triggers.map((t) => executeTriggerFunction(t, interaction))
      )
    } else if (interaction.view.callback_id === 'step_branch_edit') {
      // the branching info is edited

      const { id, stepId } = JSON.parse(interaction.view.private_metadata) as {
        id: number
        stepId: string
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return
      const steps = getWorkflowSteps(workflow)
      const step = steps.find((s) => s.id === stepId)
      if (!step) return

      const op =
        interaction.view.state.values.step_branch_op!.value!.selected_option!
          .value
      let left = ''
      let right = ''

      for (const [blockId, values] of Object.entries(
        interaction.view.state.values
      )) {
        if (blockId.startsWith('step_branch_left'))
          left = Object.values(values)[0]!.value!
        if (blockId.startsWith('step_branch_right'))
          right = Object.values(values)[0]!.value!
      }

      step.branching = JSON.stringify({ left, op, right })
      workflow.steps = JSON.stringify(steps)
      await updateWorkflow(workflow)

      await updateHomeTab(workflow, interaction.user.id)
    } else if (interaction.view.callback_id === 'workflow_details_edited') {
      const { id } = JSON.parse(interaction.view.private_metadata) as {
        id: number
      }
      const workflow = await getWorkflowById(id)
      if (!workflow || !workflow.access_token) return

      const name = interaction.view.state.values.name!.value!.value!
      const description =
        interaction.view.state.values.description!.value!.value!
      const pfp = interaction.view.state.values.pfp!.value!.files?.[0]

      if (name !== workflow.name || description !== workflow.description) {
        workflow.name = name
        workflow.description = description
        await updateWorkflow(workflow)

        const triggerType =
          (await getWorkflowTrigger(workflow.id))?.type || 'none'
        const manifest = generateManifest(workflow.name, triggerType)
        await slack.apps.manifest.update({
          token: await getActiveConfigToken(),
          app_id: workflow.app_id,
          manifest,
        })

        await updateHomeTab(workflow, interaction.user.id)
      }

      if (pfp) {
        const res = await fetch(pfp.url_private_download!, {
          headers: {
            Authorization: `Bearer ${workflow.access_token}`,
          },
        }).then((r) => r.blob())

        await setAppPhoto(
          workflow.app_id,
          new Blob([res], { type: pfp.mimetype }),
          pfp.name
        )
      }
    }
  }
}

registerTriggerFunction(
  'workflow.execute.message',
  async (trigger, message: SlackEvent & { type: 'message' }) => {
    // FIXME: more subtypes allowed?
    if (
      message.subtype &&
      message.subtype !== 'file_share' &&
      message.subtype !== 'me_message'
    )
      return
    const workflow = await getWorkflowById(trigger.workflow_id!)
    if (!workflow) return deleteTriggerById(trigger.id)
    await startWorkflow(workflow, workflow.creator_user_id, {
      'trigger.message': JSON.stringify({
        channel: message.channel,
        ts: message.ts,
      }),
      'trigger.message.user': message.user,
      'trigger.message.user_ping': `<@${message.user}>`,
    })
  }
)

registerTriggerFunction(
  'workflow.execute.reaction',
  async (trigger, event: SlackEvent & { type: 'reaction_added' }) => {
    const workflow = await getWorkflowById(trigger.workflow_id!)
    if (!workflow) return deleteTriggerById(trigger.id)
    await startWorkflow(workflow, workflow.creator_user_id, {
      'trigger.message': JSON.stringify({
        channel: event.item.channel,
        ts: event.item.ts,
      }),
      'trigger.user': event.user,
      'trigger.user_ping': `<@${event.user}>`,
    })
  }
)

registerTriggerFunction('workflow.execute.cron', async (trigger) => {
  const workflow = await getWorkflowById(trigger.workflow_id!)
  if (!workflow) return deleteTriggerById(trigger.id)
  await startWorkflow(workflow, workflow.creator_user_id)
})

registerTriggerFunction(
  'workflow.execute.member_join',
  async (trigger, event: MemberJoinedChannelEvent) => {
    const workflow = await getWorkflowById(trigger.workflow_id!)
    if (!workflow) return deleteTriggerById(trigger.id)
    await startWorkflow(workflow, workflow.creator_user_id, {
      'trigger.user': `${event.user}`,
      'trigger.user_ping': `<@${event.user}>`,
    })
  }
)

async function updateTriggerAndJoin(
  interaction: SlackAction,
  workflow: Workflow,
  trigger: Trigger,
  text: string,
  channel: string
) {
  trigger.val_string = text
  await updateTrigger(trigger)

  // maybe join the convo
  let joinSuccess = false
  try {
    await slack.conversations.join({
      token: workflow.access_token!,
      channel,
    })
    joinSuccess = true
  } catch (e) {
    console.warn('Failed to join trigger conversation:', e)
  }

  await updateHomeTab(workflow, interaction.user.id, {
    triggerBlocks: joinSuccess
      ? []
      : [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: "Failed to join the selected channel. Maybe it's private? Please invite me to the channel manually for me to work!\n_Note: DMs aren't supported because you can't add a bot to a DM :(_",
            },
          },
        ],
  })
}

async function handleDynamicInputs(interaction: BlockSuggestion) {
  const value = interaction.value
  if (interaction.view?.callback_id === 'step_edit') {
    if (interaction.action_id.startsWith('update_input:')) {
      // some step input is being selected
      const [, , , inputKey] = interaction.action_id.split(':')

      const { id, stepId } = JSON.parse(interaction.view.private_metadata) as {
        id: number
        stepId: string
      }
      const workflow = await getWorkflowById(id)
      if (!workflow) {
        return Response.json({
          options: [
            {
              text: { type: 'plain_text', text: 'Workflow not found' },
              value: '',
            },
          ],
        })
      }
      const steps = getWorkflowSteps(workflow)
      const step = steps.find((s) => s.id === stepId)
      if (!step) {
        return Response.json({
          options: [
            {
              text: { type: 'plain_text', text: 'Step not found' },
              value: '',
            },
          ],
        })
      }
      const spec = stepSpecs[step.type_id]!
      const input = spec.inputs[inputKey!]!

      if (input.type === 'usergroup') {
        // a usergroup input is being selected

        const res = await slack.usergroups.list({
          token: workflow.access_token!,
        })
        const groups = res
          .usergroups!.filter(
            (g) =>
              g.name?.toLowerCase().includes(value.toLowerCase()) ||
              g.handle?.toLowerCase().includes(value.toLowerCase())
          )
          .slice(0, 100)
        return Response.json({
          options: groups.map((g) => ({
            text: {
              type: 'plain_text',
              text: truncateText(`${g.name} (@${g.handle})`, 75),
            },
            value: g.id!,
          })),
        })
      } else {
        return Response.json({
          options: [
            {
              text: { type: 'plain_text', text: 'Unknown input type' },
              value: '',
            },
          ],
        })
      }
    } else {
      return Response.json({
        options: [
          {
            text: { type: 'plain_text', text: 'Unknown select field' },
            value: '',
          },
        ],
      })
    }
  } else {
    return Response.json({
      options: [
        {
          text: { type: 'plain_text', text: 'Unknown modal' },
          value: '',
        },
      ],
    })
  }
}

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
    case 'external_select':
      if (!action.selected_option) return
      return { type: 'text', text: action.selected_option.value }
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
    case 'external_select':
      return JSON.stringify({
        type: 'text',
        text: action.selected_option!.value,
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
    case 'external_select':
      return action.selected_option
    case 'rich_text_input':
      return action.rich_text_value
    case 'plain_text_input':
      return action.value
  }
}
