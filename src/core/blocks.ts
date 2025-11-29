import type { HomeView, KnownBlock } from '@slack/types'
import { getWorkflowsByCreator, type Workflow } from '../database/workflows'
import slack from '../clients/slack'
import { truncateText } from '../utils/formatting'
import { WORKFLOW_APP_SCOPES } from '../consts'

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!

export async function updateCoreHomeTab(userId: string, search?: string) {
  const workflows = await getWorkflowsByCreator(userId)

  await slack.views.publish({
    token: SLACK_BOT_TOKEN,
    user_id: userId,
    view: await generateCoreHomeView(workflows, search),
  })
}

const MAX_WORKFLOWS_PER_PAGE = 25

async function generateCoreHomeView(
  workflows: Workflow[],
  search?: string
): Promise<HomeView> {
  const filteredWorkflows = workflows.filter(
    (w) =>
      (!search || w.name.toLowerCase().includes(search.toLowerCase())) &&
      w.access_token
  )

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Welcome to Winterflows!' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Next-gen workflows, as the winter of Slack workflows arrives...',
      },
    },
    { type: 'divider' },
  ]

  if (!search) {
    const unauthedWorkflows = workflows.filter((w) => !w.access_token)
    if (unauthedWorkflows.length) {
      blocks.push(
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Unauthorized workflows' },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              'Please click on the links below to install these workflow apps to activate them!\n' +
              unauthedWorkflows
                .map(
                  (w) =>
                    `*${
                      w.name
                    }*: <https://slack.com/oauth/v2/authorize?client_id=${
                      w.client_id
                    }&scope=${encodeURIComponent(
                      WORKFLOW_APP_SCOPES.join(',')
                    )}&state=${w.app_id}|install>`
                )
                .join('\n'),
          },
        }
      )
    }
  }

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: 'Your workflows' },
  })

  if (!workflows.length) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: "You don't have any workflows yet. Use the `/winterflows-create` command to create one!",
      },
    })
  } else {
    blocks.push({
      type: 'input',
      label: { type: 'plain_text', text: ':mag: Search', emoji: true },
      element: {
        type: 'plain_text_input',
        action_id: 'search_workflows',
        placeholder: { type: 'plain_text', text: 'Type here to search' },
        initial_value: search || undefined,
        dispatch_action_config: {
          trigger_actions_on: ['on_character_entered'],
        },
      },
      dispatch_action: true,
    })
    if (!filteredWorkflows.length) {
      blocks.push({
        type: 'section',
        text: {
          type: 'plain_text',
          text: 'No matching and installed workflows found.',
        },
      })
    }
    if (filteredWorkflows.length > MAX_WORKFLOWS_PER_PAGE) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_Only the first 25 workflows shown. To see more, use the search bar above._',
        },
      })
    }
    for (const workflow of filteredWorkflows.slice(0, MAX_WORKFLOWS_PER_PAGE)) {
      blocks.push(
        { type: 'header', text: { type: 'plain_text', text: workflow.name } },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: workflow.description },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Edit' },
              url: `slack://app?id=${workflow.app_id}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Run workflow' },
              action_id: 'run_workflow_home',
              value: JSON.stringify({ id: workflow.id }),
              style: 'primary',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Delete' },
              action_id: 'delete_workflow',
              value: JSON.stringify({ id: workflow.id }),
              style: 'danger',
              confirm: {
                title: {
                  type: 'plain_text',
                  text: truncateText(`Delete "${workflow.name}"`, 100),
                },
                text: {
                  type: 'mrkdwn',
                  text: 'Are you sure you want to delete this workflow? This cannot be undone.',
                },
                confirm: { type: 'plain_text', text: 'Delete' },
                deny: { type: 'plain_text', text: 'Cancel' },
                style: 'danger',
              },
            },
          ],
        }
      )
    }
  }

  return { type: 'home', blocks }
}
