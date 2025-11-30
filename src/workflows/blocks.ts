import type {
  ActionsBlockElement,
  KnownBlock,
  ModalView,
  PlainTextElement,
  PlainTextOption,
  SectionBlockAccessory,
} from '@slack/types'
import type { Workflow } from '../database/workflows'
import { getWorkflowSteps } from '../utils/workflows'
import type { WorkflowStep } from './execute'
import type { DataType, WorkflowStepMap } from './steps'
import steps from './steps'
import slack from '../clients/slack'
import { generateRandomId, truncateText } from '../utils/formatting'
import { getTriggersWhere } from '../database/triggers'
import { sql } from 'bun'

const { EXTERNAL_URL, SLACK_APP_ID } = process.env

export interface HomeTabBlockOptions {
  triggerBlocks?: KnownBlock[]
}

export async function updateHomeTab(
  workflow: Workflow,
  user: string,
  options: HomeTabBlockOptions = {}
) {
  if (!workflow.access_token) return

  const blocks =
    user === workflow.creator_user_id
      ? await generateWorkflowEditView(workflow, options)
      : await generateWorkflowView(workflow)

  await slack.views.publish({
    token: workflow.access_token,
    user_id: user,
    view: {
      type: 'home',
      private_metadata: JSON.stringify({ id: workflow.id }),
      blocks,
    },
  })
}

export async function generateWorkflowEditView(
  workflow: Workflow,
  options: HomeTabBlockOptions
): Promise<KnownBlock[]> {
  const stepBlocks = getWorkflowSteps(workflow).flatMap((s, i) =>
    generateWorkflowStepBlocks(s, i)
  )

  const trigger = (await getTriggersWhere(sql`workflow_id = ${workflow.id}`))[0]
  const triggerType = trigger?.type || 'none'

  const triggerOptions: PlainTextOption[] = [
    {
      text: { type: 'plain_text', text: 'Link / Manual' },
      value: 'none',
    },
    {
      text: { type: 'plain_text', text: 'Message sent' },
      value: 'message',
    },
    {
      text: { type: 'plain_text', text: 'Reaction added' },
      value: 'reaction',
    },
  ]
  const triggerInitialOption = triggerOptions.find(
    (o) => o.value === triggerType
  )

  const runButtons: ActionsBlockElement[] = []
  if (triggerType === 'none') {
    runButtons.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Run workflow' },
      action_id: 'run_workflow_home',
      value: JSON.stringify({ id: workflow.id }),
      style: 'primary',
    })
  }

  const triggerActions: ActionsBlockElement[] = []
  if (triggerType === 'message') {
    triggerActions.push({
      type: 'conversations_select',
      placeholder: { type: 'plain_text', text: 'Channel to listen in' },
      action_id: 'workflow_trigger_message_update',
      initial_conversation: trigger!.val_string || undefined,
    })
  } else if (triggerType === 'reaction') {
    triggerActions.push({
      type: 'conversations_select',
      placeholder: { type: 'plain_text', text: 'Channel to listen in' },
      action_id: 'workflow_trigger_reaction_update_channel',
      initial_conversation: trigger!.val_string?.split('|')[0] || undefined,
    })
  }

  const triggerBlocks: KnownBlock[] = []
  if (triggerType === 'none') {
    triggerBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Workflow link: <${EXTERNAL_URL}/workflow/${workflow.id}>`,
      },
    })
  }
  if (triggerType === 'reaction') {
    triggerBlocks.push({
      type: 'input',
      label: {
        type: 'plain_text',
        text: 'Emoji that triggers the workflow (without colons)',
      },
      dispatch_action: true,
      element: {
        type: 'plain_text_input',
        action_id: 'workflow_trigger_reaction_update_emoji',
        initial_value: trigger!.val_string?.split('|')[1] || undefined,
      },
    })
  }
  if (options.triggerBlocks) triggerBlocks.push(...options.triggerBlocks)

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: workflow.name },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: workflow.description },
    },
    {
      type: 'actions',
      elements: [
        ...runButtons,
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View all your workflows' },
          url: `slack://app?id=${SLACK_APP_ID}`,
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Trigger' },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Edit trigger' },
          action_id: 'edit_workflow_trigger',
          options: triggerOptions,
          initial_option: triggerInitialOption,
        },
        ...triggerActions,
      ],
    },
    ...triggerBlocks,
    { type: 'divider' },
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Steps' },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'static_select',
          action_id: 'new_step',
          placeholder: {
            type: 'plain_text',
            text: ':heavy_plus_sign: Add a step',
            emoji: true,
          },
          option_groups: getStepOptionGroups(),
        },
      ],
    },
    ...stepBlocks,
  ]
}

function getStepOptionGroups() {
  const groups: Record<
    string,
    { label: PlainTextElement; options: PlainTextOption[] }
  > = {}

  for (const [id, spec] of Object.entries(steps)) {
    const group =
      groups[spec.category] ||
      (groups[spec.category] = {
        label: { type: 'plain_text', text: spec.category },
        options: [],
      })
    group.options.push({
      text: { type: 'plain_text', text: spec.name },
      value: id,
    })
  }

  const groupArray = Object.values(groups)
  groupArray.sort((a, b) => a.label.text.localeCompare(b.label.text))
  for (const group of groupArray) {
    group.options.sort((a, b) => a.text.text.localeCompare(b.text.text))
  }

  return groupArray
}

function generateWorkflowStepBlocks<T extends keyof WorkflowStepMap>(
  step: WorkflowStep<T>,
  index: number
): KnownBlock[] {
  const id = step.type_id
  const spec = steps[id]

  let text = ''

  if (spec) {
    text += `${index + 1}. *${spec.name}*`

    for (const [key, arg] of Object.entries(spec.inputs)) {
      const value = step.inputs[key] ? `\`${step.inputs[key]}\`` : '<no value>'
      text += `\n${arg.name}: ${value}`
    }
  } else {
    text += `${index + 1}. This step no longer exists. Please remove it.`
  }

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text },
      accessory: {
        type: 'overflow',
        options: [
          {
            text: { type: 'plain_text', text: 'Edit' },
            value: JSON.stringify({ action: 'edit', id: step.id }),
          },
          {
            text: { type: 'plain_text', text: 'Delete' },
            value: JSON.stringify({ action: 'delete', id: step.id }),
          },
        ],
        action_id: 'manage_step',
      },
    },
  ]
}

export async function generateWorkflowView(
  workflow: Workflow
): Promise<KnownBlock[]> {
  const trigger = (await getTriggersWhere(sql`workflow_id = ${workflow.id}`))[0]

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: workflow.name },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: workflow.description },
    },
    trigger
      ? {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `This workflow starts on a ${trigger.type} trigger.`,
            },
          ],
        }
      : {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Run workflow' },
              action_id: 'run_workflow_home',
              value: JSON.stringify({ id: workflow.id }),
              style: 'primary',
            },
          ],
        },
  ]
}

export async function generateStepEditView(
  workflow: Workflow,
  stepId: string,
  overrideValues: Record<string, any> = {}
): Promise<ModalView> {
  const workflowSteps = getWorkflowSteps(workflow)
  const stepIndex = workflowSteps.findIndex((s) => s.id === stepId)
  const step = workflowSteps[stepIndex]!

  const spec = steps[step.type_id as keyof WorkflowStepMap]!

  const trigger = (await getTriggersWhere(sql`workflow_id = ${workflow.id}`))[0]
  const triggerType = trigger?.type || 'none'

  const inputBlocks = Object.entries(spec.inputs).flatMap(([key, def]) => {
    let currentValue = step.inputs[key]
      ? `\`${step.inputs[key]}\``
      : '<no value>'
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${def.name}*${
            def.required ? ' _(required)_' : ''
          }\nCurrent: ${currentValue}`,
        },
        accessory: getStepInputAccessory(workflow, stepIndex, key, triggerType),
      },
      ...generateStepInputBlocks(
        workflow,
        stepIndex,
        key,
        triggerType,
        overrideValues
      ),
    ] satisfies KnownBlock[]
  })

  return {
    type: 'modal',
    title: {
      type: 'plain_text',
      text: truncateText(`Editing step ${stepIndex + 1}`, 24),
    },
    submit: { type: 'plain_text', text: 'Save' },
    callback_id: 'step_edit',
    private_metadata: JSON.stringify({ id: workflow.id, stepId: step.id }),
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: spec.name } },
      { type: 'section', text: { type: 'mrkdwn', text: '*Inputs*' } },
      ...inputBlocks,
    ],
  }
}

function generateStepInputBlocks(
  workflow: Workflow,
  index: number,
  inputKey: string,
  triggerType: string,
  overrideValues: Record<string, any> = {}
): KnownBlock[] {
  const workflowSteps = getWorkflowSteps(workflow)
  const step = workflowSteps[index]!
  const spec = steps[step.type_id as keyof WorkflowStepMap]!
  const input = spec.inputs[inputKey]!
  const currentValue = step.inputs[inputKey]!

  const blocks: KnownBlock[] = []

  const actionId = `update_input:${workflow.id}:${step.id}:${inputKey}`
  if (input.type === 'user' && !currentValue.startsWith('$')) {
    blocks.push({
      type: 'input',
      block_id: generateRandomId(),
      label: { type: 'plain_text', text: ' ' },
      element: {
        type: 'users_select',
        initial_user: overrideValues[actionId] || currentValue || undefined,
        action_id: actionId,
      },
    })
  }
  if (input.type === 'channel' && !currentValue.startsWith('$')) {
    blocks.push({
      type: 'input',
      block_id: generateRandomId(),
      label: { type: 'plain_text', text: ' ' },
      element: {
        type: 'conversations_select',
        initial_conversation:
          overrideValues[actionId] || currentValue || undefined,
        action_id: actionId,
      },
    })
  }
  if (input.type === 'rich_text') {
    blocks.push({
      type: 'input',
      block_id: generateRandomId(),
      label: { type: 'plain_text', text: ' ' },
      element: {
        type: 'rich_text_input',
        initial_value:
          overrideValues[actionId] ||
          (currentValue ? JSON.parse(currentValue) : undefined),
        action_id: actionId,
      },
    })
  }
  if (input.type === 'text') {
    blocks.push({
      type: 'input',
      block_id: generateRandomId(),
      label: { type: 'plain_text', text: ' ' },
      element: {
        type: 'plain_text_input',
        initial_value: overrideValues[actionId] || currentValue || undefined,
        action_id: actionId,
      },
    })
  }
  if (input.type === 'rich_text' || input.type === 'text') {
    const { groups, initial } = getTokenOptionGroups(
      workflowSteps.slice(0, index),
      triggerType,
      input.type === 'rich_text' ? ['text', 'rich_text'] : ['text'],
      undefined
    )

    if (groups.length) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'static_select',
            placeholder: {
              type: 'plain_text',
              text: ':heavy_plus_sign: Add a token',
              emoji: true,
            },
            action_id: `input_token:${inputKey}`,
            option_groups: groups,
            initial_option: initial,
          },
        ],
      })
    }
  }

  return blocks
}

function getStepInputAccessory(
  workflow: Workflow,
  index: number,
  inputKey: string,
  triggerType: string
): SectionBlockAccessory | undefined {
  const workflowSteps = getWorkflowSteps(workflow)
  const step = workflowSteps[index]!
  const spec = steps[step.type_id as keyof WorkflowStepMap]
  if (!spec) return
  const input = spec.inputs[inputKey]
  if (!input) return

  if (input.type === 'user' || input.type === 'channel') {
    const prependGroups: {
      label: PlainTextElement
      options: PlainTextOption[]
    }[] = [
      {
        label: { type: 'plain_text', text: 'Custom' },
        options: [
          {
            text: { type: 'plain_text', text: `Choose a ${input.type}` },
            value: JSON.stringify({ type: 'custom' }),
          },
        ],
      },
    ]

    const { groups, initial } = getTokenOptionGroups(
      workflowSteps.slice(0, index),
      triggerType,
      [input.type],
      step.inputs[inputKey],
      prependGroups
    )

    return {
      type: 'static_select',
      action_id: `update_category:${workflow.id}:${step.id}:${inputKey}`,
      option_groups: groups,
      initial_option: initial || groups[0]!.options[0],
    }
  } else if (input.type === 'message') {
    const { groups, initial } = getTokenOptionGroups(
      workflowSteps.slice(0, index),
      triggerType,
      [input.type],
      step.inputs[inputKey]
    )

    if (groups.length) {
      return {
        type: 'static_select',
        action_id: `update_category:${workflow.id}:${step.id}:${inputKey}`,
        option_groups: groups,
        initial_option: initial || groups[0]!.options[0],
      }
    }
  }
}

function getTokenOptionGroups(
  allSteps: WorkflowStep<any>[],
  triggerType: string,
  types: DataType[],
  currentValue?: string,
  prependGroups: { label: PlainTextElement; options: PlainTextOption[] }[] = []
) {
  const groups: { label: PlainTextElement; options: PlainTextOption[] }[] = [
    ...prependGroups,
  ]

  console.log(triggerType, types)
  const triggerOptions: PlainTextOption[] = []
  // link triggers
  if (triggerType === 'none' && types.includes('rich_text')) {
    triggerOptions.push({
      text: { type: 'plain_text', text: '@user who used this workflow' },
      value: JSON.stringify({
        type: 'text',
        text: '$!{ctx.trigger_user_ping}',
      }),
    })
  }
  if (triggerType === 'none' && types.includes('user')) {
    triggerOptions.push({
      text: { type: 'plain_text', text: 'User who used this workflow' },
      value: JSON.stringify({
        type: 'text',
        text: '$!{ctx.trigger_user_id}',
      }),
    })
  }
  // message triggers
  if (triggerType === 'message' && types.includes('message')) {
    triggerOptions.push({
      text: {
        type: 'plain_text',
        text: 'Message that triggered this workflow',
      },
      value: JSON.stringify({ type: 'text', text: '$!{trigger.message}' }),
    })
  }
  if (triggerType === 'message' && types.includes('user')) {
    triggerOptions.push({
      text: { type: 'plain_text', text: 'Sender of trigger message' },
      value: JSON.stringify({ type: 'text', text: '$!{trigger.message.user}' }),
    })
  }
  if (triggerType === 'message' && types.includes('rich_text')) {
    triggerOptions.push({
      text: { type: 'plain_text', text: '@user who sent the trigger message' },
      value: JSON.stringify({
        type: 'text',
        text: '$!{trigger.message.user_ping}',
      }),
    })
  }
  // reaction triggers
  if (triggerType === 'reaction' && types.includes('message')) {
    triggerOptions.push({
      text: { type: 'plain_text', text: 'Message where reaction was used' },
      value: JSON.stringify({ type: 'text', text: '$!{trigger.message}' }),
    })
  }
  if (triggerType === 'reaction' && types.includes('user')) {
    triggerOptions.push({
      text: { type: 'plain_text', text: 'Person who added the reaction' },
      value: JSON.stringify({ type: 'text', text: '$!{trigger.user}' }),
    })
  }
  if (triggerType === 'reaction' && types.includes('rich_text')) {
    triggerOptions.push({
      text: { type: 'plain_text', text: '@user who added the reaction' },
      value: JSON.stringify({ type: 'text', text: '$!{trigger.user_ping}' }),
    })
  }
  if (triggerOptions.length) {
    groups.push({
      label: { type: 'plain_text', text: 'Workflow trigger' },
      options: triggerOptions,
    })
  }

  for (const step of allSteps) {
    const spec = steps[step.type_id as keyof WorkflowStepMap]
    if (!spec) continue
    const options: PlainTextOption[] = []

    let idx = 0
    for (const [key, output] of Object.entries(spec.outputs)) {
      idx++
      if (types.includes(output.type)) {
        options.push({
          text: { type: 'plain_text', text: output.name },
          value: JSON.stringify({
            type: 'text',
            text: `$!{outputs.${step.id}.${key}}`,
          }),
        })
      }
    }

    if (options.length) {
      groups.push({
        label: { type: 'plain_text', text: `${idx}. ${spec.name}` },
        options,
      })
    }
  }

  let initial: PlainTextOption | undefined = undefined
  for (const group of groups) {
    for (const option of group.options) {
      if (JSON.parse(option.value!).text === currentValue) {
        initial = option
      }
    }
  }

  return { groups, initial }
}
