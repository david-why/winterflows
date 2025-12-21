import slack from '../clients/slack'
import { updateWorkflow, type Workflow } from '../database/workflows'
import steps, { type WorkflowStepSpec } from './steps'

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
      key: 'comments',
      name: 'Comments',
      is_primary_column: true,
      type: 'text',
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
  ]
}
