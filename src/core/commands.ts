import type { SlashCommand } from '@slack/bolt'
import type {
  AppsManifestCreateArguments,
  AppsManifestCreateResponse,
} from '@slack/web-api'
import slack from '../clients/slack'
import { addWorkflow } from '../database/workflows'
import { getActiveConfigToken, respond } from '../utils/slack'
import { WORKFLOW_APP_SCOPES } from '../consts'

const { EXTERNAL_URL, SLACK_APP_ID } = process.env

export async function handleCommand(payload: SlashCommand) {
  if (payload.command.endsWith('winterflows-create')) {
    return await handleCreateCommand(payload)
  } else if (payload.command.endsWith('winterflows')) {
    return await handleRootCommand()
  }
  return ''
}

async function handleCreateCommand(payload: SlashCommand) {
  const name = payload.text
  if (!name) {
    return 'Please provide a name for the workflow.'
  }

  const configToken = await getActiveConfigToken()
  if (!configToken) {
    return 'No app config token was set, or it has expired. Please contact the devs for assistance.'
  }

  ;(async () => {
    let app: AppsManifestCreateResponse
    try {
      app = await slack.apps.manifest.create({
        token: configToken,
        manifest: generateManifest(name),
      })
    } catch (e) {
      console.error('Failed to create app from manifest:', e)
      await respond(payload, 'There was an error creating the app.')
      return
    }

    await addWorkflow({
      name,
      app_id: app.app_id!,
      creator_user_id: payload.user_id,
      client_id: app.credentials!.client_id!,
      client_secret: app.credentials!.client_secret!,
      signing_secret: app.credentials!.signing_secret!,
      access_token: null,
    })

    const url = new URL(app.oauth_authorize_url!)
    url.searchParams.set('state', app.app_id!)

    await respond(payload, {
      text: `Please visit <${url.toString()}|this link> and install the app to finish the workflow setup.`,
    })
  })()
}

function generateManifest(
  name: string
): AppsManifestCreateArguments['manifest'] {
  return {
    display_information: {
      name: name,
      description: 'Workflow created by Winterflows',
    },
    features: {
      app_home: {
        home_tab_enabled: true,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: true,
      },
      bot_user: {
        display_name: name,
        always_online: false,
      },
    },
    oauth_config: {
      redirect_urls: [`${EXTERNAL_URL}/oauth/callback`],
      scopes: {
        bot: WORKFLOW_APP_SCOPES,
      },
    },
    settings: {
      event_subscriptions: {
        request_url: `${EXTERNAL_URL}/slack/events`,
        bot_events: ['app_home_opened'],
      },
      interactivity: {
        is_enabled: true,
        request_url: `${EXTERNAL_URL}/slack/interaction`,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  }
}

async function handleRootCommand() {
  return Response.json({
    text: `\
:hyper-dino-wave: Hi, and welcome to Winterflows!

I am a replacement to Slack's workflows, since the winter of Slack workflows will soon dawn upon us...

To get started, <slack://app?id=${SLACK_APP_ID}|visit my app home>, or use the \`/winterflows-create\` command to create your first workflow!`,
  })
}
