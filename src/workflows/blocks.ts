import type {
  KnownBlock,
  ModalView,
  PlainTextElement,
  PlainTextOption,
  SectionBlockAccessory,
} from '@slack/types'
import type { Workflow } from '../database/workflows'
import { getWorkflowSteps } from '../utils/workflows'
import type { WorkflowStep } from './execute'
import type { WorkflowStepMap } from './steps'
import steps from './steps'
import slack from '../clients/slack'
import { truncateText } from '../utils/formatting'

const { EXTERNAL_URL } = process.env

export async function updateHomeTab(workflow: Workflow, user: string) {
  if (!workflow.access_token) return

  const blocks =
    user === workflow.creator_user_id
      ? await generateWorkflowEditView(workflow)
      : await generateWorkflowView(workflow)

  await slack.views.publish({
    token: workflow.access_token,
    user_id: user,
    view: { type: 'home', blocks },
  })
}

export async function generateWorkflowEditView(
  workflow: Workflow
): Promise<KnownBlock[]> {
  const stepBlocks = getWorkflowSteps(workflow).flatMap((s, i) =>
    generateWorkflowStepBlocks(s, i, workflow)
  )

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: workflow.name },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${workflow.description}\n\n_Workflow link: <${EXTERNAL_URL}/workflow/${workflow.id}>_`,
      },
    },
    {
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
          options: Object.entries(steps).map(([id, spec]) => ({
            text: { type: 'plain_text', text: spec.name },
            value: JSON.stringify({ w: workflow.id, s: id }),
          })),
        },
      ],
    },
    ...stepBlocks,
  ]
}

function generateWorkflowStepBlocks<T extends keyof WorkflowStepMap>(
  step: WorkflowStep<T>,
  index: number,
  workflow: Workflow
): KnownBlock[] {
  const id = step.type_id
  const spec = steps[id]

  let text = `${index + 1}. *${spec.name}*`

  for (const [key, arg] of Object.entries(spec.inputs)) {
    text += `\n${arg.name}: \`${step.inputs[key as keyof typeof step.inputs]}\``
  }

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Edit' },
        value: JSON.stringify({ workflowId: workflow.id, stepId: step.id }),
        action_id: 'edit_step',
      },
    },
  ]
}

export async function generateWorkflowView(
  workflow: Workflow
): Promise<KnownBlock[]> {
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
        accessory: getStepInputAccessory(workflow, stepIndex, key),
      },
      ...generateStepInputBlocks(workflow, stepIndex, key, overrideValues),
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
  overrideValues: Record<string, any> = {}
): KnownBlock[] {
  const workflowSteps = getWorkflowSteps(workflow)
  const step = workflowSteps[index]!
  const spec = steps[step.type_id as keyof WorkflowStepMap]
  const input = spec.inputs[inputKey as keyof typeof spec.inputs]
  const currentValue = step.inputs[inputKey]!

  const blocks: KnownBlock[] = []

  const actionId = `update_input:${workflow.id}:${step.id}:${inputKey}`
  if (input.type === 'user' && !currentValue.startsWith('$')) {
    blocks.push({
      type: 'input',
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

  return blocks
}

function getStepInputAccessory(
  workflow: Workflow,
  index: number,
  inputKey: string
): SectionBlockAccessory | undefined {
  const workflowSteps = getWorkflowSteps(workflow)
  const step = workflowSteps[index]!
  const spec = steps[step.type_id as keyof WorkflowStepMap]
  const input = spec.inputs[inputKey as keyof typeof spec.inputs]

  if (input.type === 'user' || input.type === 'channel') {
    const groups: {
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

    if (input.type === 'user') {
      groups.push({
        label: { type: 'plain_text', text: 'Workflow info' },
        options: [
          {
            text: { type: 'plain_text', text: 'Person who used this workflow' },
            value: JSON.stringify({
              type: 'text',
              text: '$!{ctx.trigger_user_id}',
            }),
          },
        ],
      })
    }

    for (const step of workflowSteps.slice(0, index)) {
      const spec = steps[step.type_id as keyof WorkflowStepMap]
      const options: PlainTextOption[] = []

      let idx = 0
      for (const [key, output] of Object.entries(spec.outputs)) {
        idx++
        if (output.type === input.type) {
          options.push({
            text: { type: 'plain_text', text: input.name },
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

    let initial: PlainTextOption | undefined = groups[0]?.options[0]
    for (const group of groups) {
      for (const option of group.options) {
        if (JSON.parse(option.value!).text === step.inputs[inputKey]) {
          initial = option
        }
      }
    }

    return {
      type: 'static_select',
      action_id: `update_category:${workflow.id}:${step.id}:${inputKey}`,
      option_groups: groups,
      initial_option: initial,
    }
  }
}
