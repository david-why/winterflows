import slack from '../clients/slack'
import { updateWorkflow, type Workflow } from '../database/workflows'
import { generateRandomId } from '../utils/formatting'
import steps, { type WorkflowStepSpec } from './steps'
import type { RichTextBlock, RichTextElement } from '@slack/types'

const { EXTERNAL_URL } = process.env

export async function createWorkflowCanvas(workflow: Workflow) {
  if (!workflow.access_token) throw new Error('Workflow is not installed')

  const auth = await slack.auth.test({ token: workflow.access_token })
  const userId = auth.user_id!
  if (!workflow.list_id) {
    const list = await slack.slackLists.create({
      token: workflow.access_token,
      name: 'Steps',
      description_blocks: [
        {
          type: 'rich_text',
          elements: [
            {
              type: 'rich_text_section',
              elements: [
                { type: 'text', text: 'Steps for ' },
                { type: 'user', user_id: userId },
              ],
            },
          ],
        },
      ],
      schema: generateListSchema(),
    })
    await slack.slackLists.access.set({
      token: workflow.access_token,
      list_id: list.list_id!,
      access_level: 'write',
      user_ids: [workflow.creator_user_id],
    })
    workflow.list_id = list.list_id!
  }
  if (!workflow.canvas_id) {
    const canvas = await slack.canvases.create({
      token: workflow.access_token,
      title: workflow.name,
      document_content: {
        type: 'markdown',
        markdown: `![](${EXTERNAL_URL}/workflow/${workflow.id})\n\n![](https://hackclub.slack.com/lists/T0266FRGM/${workflow.list_id})`,
      },
    })
    await slack.canvases.access.set({
      token: workflow.access_token,
      canvas_id: canvas.canvas_id!,
      access_level: 'write',
      user_ids: [workflow.creator_user_id],
    })
    workflow.canvas_id = canvas.canvas_id!
  }

  await updateWorkflow(workflow)
}

export async function deleteWorkflowCanvas(workflow: Workflow) {
  if (!workflow.access_token) throw new Error('Workflow is not installed')

  if (workflow.canvas_id) {
    await slack.canvases.delete({
      token: workflow.access_token,
      canvas_id: workflow.canvas_id,
    })
    workflow.canvas_id = null
  }
  if (workflow.list_id) {
    await slack.files.delete({
      token: workflow.access_token,
      file: workflow.list_id,
    })
    workflow.list_id = null
  }

  await updateWorkflow(workflow)
}

export async function onWorkflowListUpdated(workflow: Workflow) {
  // only check if any step types changed and update the arguments and outputs
  // also empty step numbers and ids
  if (!workflow.access_token || !workflow.list_id) return

  console.log('list updated for', workflow.name)

  const [data, file] = await Promise.all([
    slack.slackLists.items.list({
      token: workflow.access_token,
      list_id: workflow.list_id,
      limit: 999,
    }),
    slack.files.info({
      token: workflow.access_token,
      file: workflow.list_id,
    }),
  ])

  const items = data.items!
  const schema = file.file!.list_metadata!.schema!
  const getColumnByKey = (key: string) =>
    schema.find((col) => col.key === key)!.id!

  console.log(JSON.stringify(items, null, 2))

  const cells: Parameters<typeof slack.slackLists.items.update>[0]['cells'] = []

  for (const item of items) {
    const values: Record<string, any> = item.fields.reduce(
      (values, field: any) => ({
        ...values,
        [field.key]: field,
      }),
      {}
    )

    if (!values.step_id?.rich_text?.length) {
      const id = generateRandomId()
      cells.push({
        column_id: getColumnByKey('step_id'),
        row_id: item.id,
        rich_text: [
          {
            type: 'rich_text',
            elements: [
              {
                type: 'rich_text_section',
                elements: [{ type: 'text', text: id }],
              },
            ],
          },
        ],
      })
    }

    if (!values.ordinal?.number?.length) {
      let ordinal = 1
      while (
        items.find(
          (item) =>
            (item.fields.find((f: any) => f.key === 'ordinal') as any)
              ?.value === ordinal
        )
      ) {
        ordinal++
      }
      cells.push({
        column_id: getColumnByKey('ordinal'),
        row_id: item.id,
        number: [ordinal],
      })
    }

    // check the step arguments and outputs
    if (values.type?.select?.length) {
      const specId = values.type.select[0]! as string
      const spec = steps[specId]
      if (!spec) continue

      const inputNames = getInputNames(values.arguments?.rich_text || []).sort()
      const specInputNames = Object.values(spec.inputs)
        .map((x) => x.name)
        .sort()

      console.log(inputNames, specInputNames)

      if (JSON.stringify(inputNames) !== JSON.stringify(specInputNames)) {
        cells.push({
          column_id: getColumnByKey('arguments'),
          row_id: item.id,
          rich_text: [
            {
              type: 'rich_text',
              elements: [
                {
                  type: 'rich_text_section',
                  elements: Object.values(spec.inputs).flatMap(
                    (input, i) =>
                      [
                        {
                          type: 'text',
                          text: `${i === 0 ? '' : '\n'}${input.name}: unknown`,
                        },
                      ] satisfies RichTextElement[]
                  ),
                },
              ],
            },
          ],
        })
      }
    }
  }

  console.log(JSON.stringify(cells))

  if (cells.length) {
    await slack.slackLists.items.update({
      token: workflow.access_token,
      list_id: workflow.list_id,
      cells,
    })
  }
}

// utilities

const COLORS = [
  'indigo',
  'blue',
  'cyan',
  'pink',
  'yellow',
  'green',
  'gray',
  'red',
  'purple',
  'orange',
  'brown',
]

type SlackListsSchema = Parameters<
  typeof slack.slackLists.create
>[0]['schema'] & {}

function generateListSchema(): SlackListsSchema {
  const categoryMap: Record<string, (WorkflowStepSpec & { id: string })[]> = {}
  for (const [id, step] of Object.entries(steps)) {
    if (!categoryMap[step.category]) {
      categoryMap[step.category] = []
    }
    categoryMap[step.category]!.push({ ...step, id })
  }
  const stepChoices = Object.entries(categoryMap)
    .sort()
    .flatMap(([, steps], i) =>
      steps.map((step) => ({
        value: step.id,
        label: step.name,
        color: COLORS[i % COLORS.length]!,
      }))
    )

  return [
    {
      key: 'step_id',
      name: 'Step ID (autogenerated, must be unique alphanumeric if changed)',
      is_primary_column: true,
      type: 'text',
    },
    {
      key: 'ordinal',
      name: 'Step number (starting from 1)',
      type: 'number',
      options: { precision: 0 },
    },
    {
      key: 'type',
      name: 'Step',
      type: 'select',
      options: { format: 'single_select', choices: stepChoices },
    },
    {
      key: 'arguments',
      name: 'Arguments',
      type: 'text',
    },
    {
      key: 'outputs',
      name: 'Outputs (do not edit)',
      type: 'text',
    },
    {
      key: 'branching',
      name: 'Branching',
      type: 'text',
    },
    {
      key: 'arg_1',
      name: 'Rich text argument 1',
      type: 'text',
    },
  ]
}

function getInputNames(text: RichTextBlock[]) {
  const names: string[] = []

  let isNewLine = true
  for (const block of text) {
    for (const section of block.elements) {
      if (section.type !== 'rich_text_section') continue
      for (const element of section.elements) {
        if (element.type !== 'text') {
          isNewLine = false
          continue
        }
        const value: string = (isNewLine ? '\n' : '') + element.text
        const lines = value.split('\n').slice(1)
        for (const line of lines) {
          if (line.includes(':')) {
            names.push(line.split(':')[0]!)
          }
        }
        isNewLine = value.endsWith('\n')
      }
    }
  }

  return names
}
