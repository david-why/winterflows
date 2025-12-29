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
import { getTriggersWhere, getWorkflowTrigger } from '../database/triggers'
import { sql } from 'bun'
import { getLatestWorkflowVersion } from '../database/workflow_versions'

const { EXTERNAL_URL, SLACK_APP_ID, DISABLE_CANVAS } = process.env

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
      text: { type: 'plain_text', text: 'Cron schedule' },
      value: 'cron',
    },
    {
      text: { type: 'plain_text', text: 'User joins a channel' },
      value: 'member_join',
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
  if (!DISABLE_CANVAS) {
    if (workflow.canvas_id) {
      runButtons.push({
        type: 'button',
        text: { type: 'plain_text', text: 'Reset canvas' },
        action_id: 'create_workflow_canvas',
        value: JSON.stringify({ id: workflow.id }),
        style: 'danger',
      })
      runButtons.push({
        type: 'button',
        text: { type: 'plain_text', text: 'Open in canvas' },
        url: `https://hackclub.slack.com/docs/T0266FRGM/${workflow.canvas_id}`,
      })
    } else {
      runButtons.push({
        type: 'button',
        text: { type: 'plain_text', text: 'Create canvas' },
        action_id: 'create_workflow_canvas',
        value: JSON.stringify({ id: workflow.id }),
      })
    }
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
  } else if (triggerType === 'member_join') {
    triggerActions.push({
      type: 'conversations_select',
      placeholder: { type: 'plain_text', text: 'Channel to listen in' },
      action_id: 'workflow_trigger_member_join_update',
      initial_conversation: trigger!.val_string || undefined,
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
  } else if (triggerType === 'reaction') {
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
  } else if (triggerType === 'cron') {
    triggerBlocks.push({
      type: 'input',
      label: { type: 'plain_text', text: 'Cron expression (in UTC)' },
      dispatch_action: true,
      element: {
        type: 'plain_text_input',
        action_id: 'workflow_trigger_cron_update',
        initial_value: trigger?.val_string || undefined,
        dispatch_action_config: {
          trigger_actions_on: ['on_enter_pressed'],
        },
      },
    })
  }
  if (options.triggerBlocks) triggerBlocks.push(...options.triggerBlocks)

  const latestVersion = await getLatestWorkflowVersion(workflow.id)

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: workflow.name },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${workflow.description}\n\n_(Current version ID: ${latestVersion?.id})_`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Publish version' },
          action_id: 'publish_workflow',
          style: 'primary',
          confirm: {
            title: { type: 'plain_text', text: 'Publish this version?' },
            text: {
              type: 'mrkdwn',
              text: 'This will cause all future runs of the workflow to immediately use these steps.',
            },
            confirm: { type: 'plain_text', text: 'Publish' },
            deny: { type: 'plain_text', text: 'Cancel' },
            style: 'primary',
          },
        },
        ...runButtons,
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Edit details' },
          action_id: 'edit_workflow_details',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View all your workflows' },
          url: `slack://app?id=${SLACK_APP_ID}&tab=home`,
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

    if (step.branching) {
      const { left, op, right } = JSON.parse(step.branching)
      text += `\n_Only runs if_ \`${left}\` ${op} \`${right}\``
    }

    for (const [key, arg] of Object.entries(spec.inputs)) {
      const input = step.inputs[key]
      let value: string = `\`${input}\``
      if (!input) {
        value = '`<no value>`'
      } else if (!input.startsWith('$!{')) {
        switch (arg.type) {
          case 'channel':
            value = `<#${input}>`
            break
          case 'user':
            value = `<@${input}>`
            break
          case 'usergroup':
            value = `<!subteam^${input}>`
            break
          case 'rich_text':
            value = '`<rich text content>`'
        }
      }
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
            text: { type: 'plain_text', text: 'Move up' },
            value: JSON.stringify({ action: 'up', id: step.id }),
          },
          {
            text: { type: 'plain_text', text: 'Move down' },
            value: JSON.stringify({ action: 'down', id: step.id }),
          },
          {
            text: { type: 'plain_text', text: 'Delete' },
            value: JSON.stringify({ action: 'delete', id: step.id }),
          },
          {
            text: { type: 'plain_text', text: 'Edit branching' },
            value: JSON.stringify({ action: 'branch', id: step.id }),
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
          }\nCurrent: ${currentValue}${
            def.description ? `\n\n${def.description}` : ''
          }`,
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
      { type: 'divider' },
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
      optional: !input.required,
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
      optional: !input.required,
    })
  }
  if (input.type === 'usergroup' && !currentValue.startsWith('$')) {
    blocks.push({
      type: 'input',
      block_id: generateRandomId(),
      label: { type: 'plain_text', text: ' ' },
      element: {
        type: 'external_select',
        min_query_length: 1,
        action_id: actionId,
        initial_option:
          overrideValues[actionId] ||
          (currentValue && {
            text: { type: 'plain_text', text: currentValue },
            value: currentValue,
          }) ||
          undefined,
      },
      optional: !input.required,
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
      optional: !input.required,
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
      optional: !input.required,
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

  if (
    input.type === 'user' ||
    input.type === 'channel' ||
    input.type === 'usergroup'
  ) {
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
  // member_join triggers
  if (triggerType === 'member_join' && types.includes('user')) {
    triggerOptions.push({
      text: { type: 'plain_text', text: 'Person who joined the channel' },
      value: JSON.stringify({ type: 'text', text: '$!{trigger.user}' }),
    })
  }
  if (triggerType === 'member_join' && types.includes('rich_text')) {
    triggerOptions.push({
      text: { type: 'plain_text', text: '@user who joined the channel' },
      value: JSON.stringify({ type: 'text', text: '$!{trigger.user_ping}' }),
    })
  }

  if (triggerOptions.length) {
    groups.push({
      label: { type: 'plain_text', text: 'Workflow trigger' },
      options: triggerOptions,
    })
  }

  for (const [idx, step] of allSteps.entries()) {
    const spec = steps[step.type_id as keyof WorkflowStepMap]
    if (!spec) continue
    const options: PlainTextOption[] = []

    for (const [key, output] of Object.entries(spec.outputs)) {
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
        label: { type: 'plain_text', text: `${idx + 1}. ${spec.name}` },
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

export async function generateStepBranchView(
  workflow: Workflow,
  stepId: string,
  overrideValues: { left?: string; op?: string; right?: string } = {}
): Promise<ModalView> {
  const steps = getWorkflowSteps(workflow)
  const index = steps.findIndex((s) => s.id === stepId)!
  const step = steps[index]!
  const branching: { left: string; op: string; right: string } = step.branching
    ? JSON.parse(step.branching)
    : { left: '', op: '==', right: '' }

  const trigger = await getWorkflowTrigger(workflow.id)
  const triggerType = trigger?.type || 'none'

  const opOptions: PlainTextOption[] = [
    { text: { type: 'plain_text', text: '==' }, value: '==' },
    { text: { type: 'plain_text', text: '!=' }, value: '!=' },
  ]
  const opInitial =
    opOptions.find((o) => o.value === (overrideValues.op || branching.op)) ||
    opOptions[0]!

  const { groups: tokenGroups } = getTokenOptionGroups(
    steps.slice(0, index),
    triggerType,
    ['text']
  )
  const generateTokenBlocks = (actionId: string): KnownBlock[] =>
    tokenGroups.length
      ? [
          {
            type: 'actions',
            elements: [
              {
                type: 'static_select',
                placeholder: {
                  type: 'plain_text',
                  text: ':heavy_plus_sign: Add a token',
                  emoji: true,
                },
                action_id: actionId,
                option_groups: tokenGroups,
              },
            ],
          },
        ]
      : []
  const leftTokenBlocks = generateTokenBlocks('step_branch_left_token')
  const rightTokenBlocks = generateTokenBlocks('step_branch_right_token')

  const blocks: KnownBlock[] = [
    {
      type: 'input',
      label: { type: 'plain_text', text: 'LHS' },
      block_id: `step_branch_left_${generateRandomId()}`,
      element: {
        type: 'plain_text_input',
        action_id: 'value',
        initial_value: overrideValues.left || branching.left || undefined,
      },
    },
    ...leftTokenBlocks,
    {
      type: 'input',
      label: { type: 'plain_text', text: 'Operator' },
      block_id: 'step_branch_op',
      element: {
        type: 'static_select',
        action_id: 'value',
        options: opOptions,
        initial_option: opInitial,
      },
    },
    {
      type: 'input',
      label: { type: 'plain_text', text: 'RHS' },
      block_id: `step_branch_right_${generateRandomId()}`,
      element: {
        type: 'plain_text_input',
        action_id: 'value',
        initial_value: overrideValues.right || branching.right || undefined,
      },
    },
    ...rightTokenBlocks,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: 'step_branch_remove',
          text: { type: 'plain_text', text: 'Remove branching' },
          style: 'danger',
          confirm: {
            title: { type: 'plain_text', text: 'Remove branching?' },
            text: {
              type: 'mrkdwn',
              text: 'Are you sure you want to remove branching? This will permanently delete the branching rules on this step.',
            },
            confirm: { type: 'plain_text', text: 'Remove' },
            deny: { type: 'plain_text', text: 'Cancel' },
            style: 'danger',
          },
        },
      ],
    },
  ]
  console.log(JSON.stringify(blocks, null, 2))

  return {
    type: 'modal',
    callback_id: 'step_branch_edit',
    private_metadata: JSON.stringify({ id: workflow.id, stepId }),
    title: { type: 'plain_text', text: 'Edit branching' },
    submit: { type: 'plain_text', text: 'Save' },
    blocks,
  }
}

export async function generateWorkflowDetailsView(
  workflow: Workflow
): Promise<ModalView> {
  const blocks: KnownBlock[] = [
    {
      type: 'input',
      block_id: 'name',
      label: { type: 'plain_text', text: 'Name' },
      element: {
        type: 'plain_text_input',
        action_id: 'value',
        initial_value: workflow.name || undefined,
      },
    },
    {
      type: 'input',
      block_id: 'description',
      label: { type: 'plain_text', text: 'Workflow description' },
      element: {
        type: 'plain_text_input',
        action_id: 'value',
        initial_value: workflow.description,
      },
    },
    {
      type: 'input',
      block_id: 'pfp',
      optional: true,
      label: { type: 'plain_text', text: 'Profile image' },
      hint: {
        type: 'plain_text',
        text: 'Please upload a square image betweeen 512x512 and 1024x1024. PNG, JPG, and WEBP formats are supported.',
      },
      element: {
        type: 'file_input',
        action_id: 'value',
        filetypes: ['png', 'jpg', 'jpeg', 'webp'],
        max_files: 1,
      },
    },
  ]

  return {
    type: 'modal',
    callback_id: 'workflow_details_edited',
    private_metadata: JSON.stringify({ id: workflow.id }),
    title: { type: 'plain_text', text: 'Edit details' },
    submit: { type: 'plain_text', text: 'Save' },
    blocks,
  }
}
