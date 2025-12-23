import type { EnvelopedEvent, SlackAction, SlashCommand } from '@slack/bolt'
import type { SlackEvent } from '@slack/types'
import slack from './clients/slack'
import { handleCommand } from './core/commands'
import { handleCoreEvent } from './core/events'
import { handleCoreInteraction } from './core/interaction'
import {
  getWorkflowByAppId,
  getWorkflowById,
  updateWorkflow,
} from './database/workflows'
import { getVerifiedData } from './signature'
import { cronTriggerTask, timeTriggerTask } from './triggers/task'
import { getActiveConfigToken, getDMLink, getUserLink } from './utils/slack'
import { handleWorkflowEvent } from './workflows/events'
import { handleInteraction } from './workflows/interaction'
import { authenticateRequest, unauthorizedResponse } from './api/auth'
import * as workflowApi from './api/workflows'
import * as executionApi from './api/executions'
import * as triggerApi from './api/triggers'
import * as metadataApi from './api/metadata'

const PORT = process.env.PORT || '8000'
const { SLACK_APP_ID } = process.env

const NOT_FOUND = new Response('', { status: 404 })

Bun.serve({
  routes: {
    '/slack/events': {
      POST: async (req) => {
        const unsafeData = (await req.clone().json()) as any

        if (
          unsafeData.type === 'url_verification' &&
          typeof unsafeData.challenge === 'string'
        ) {
          console.debug('URL verification challenge received:', unsafeData)
          return new Response(unsafeData.challenge)
        }

        if (unsafeData.type !== 'event_callback') {
          console.debug(`Unknown payload type:`, unsafeData)
          return NOT_FOUND
        }
        if (typeof unsafeData.api_app_id !== 'string') {
          console.debug('No app ID in payload:', unsafeData)
          return NOT_FOUND
        }
        const appId: string = unsafeData.api_app_id

        console.debug(`Received event for app ID ${appId} (${SLACK_APP_ID})`)
        if (appId === SLACK_APP_ID) {
          // handle self event
          const data = await getVerifiedData(req)
          if (!data.success) {
            console.warn(`Signature verification failed:`, unsafeData)
            return NOT_FOUND
          }
          const envelope: EnvelopedEvent = JSON.parse(data.data)
          const event = envelope.event as SlackEvent

          handleCoreEvent({ event, envelope })
        } else {
          // handle workflow event
          const workflow = await getWorkflowByAppId(appId)
          if (!workflow) {
            console.warn('Request to unknown app', unsafeData)
            return NOT_FOUND
          }

          const data = await getVerifiedData(req, workflow.signing_secret)
          if (!data.success) {
            console.warn(`Signature verification failed for event:`, unsafeData)
            return NOT_FOUND
          }
          const envelope: EnvelopedEvent = JSON.parse(data.data)
          const event = envelope.event as SlackEvent

          handleWorkflowEvent({ event, envelope, workflow })
        }

        return new Response()
      },
    },

    '/slack/command': {
      POST: async (req) => {
        const data = await getVerifiedData(req)
        if (!data.success) {
          console.warn(`Signature verification failed for command`)
          return NOT_FOUND
        }
        const payload: SlashCommand = new URLSearchParams(
          data.data
        ).toJSON() as SlashCommand

        const res = await handleCommand(payload)

        return typeof res === 'string'
          ? new Response(res)
          : res || new Response()
      },
    },

    '/slack/interaction': {
      POST: async (req) => {
        const unsafeData = new URLSearchParams(
          await req.clone().text()
        ).toJSON()
        if (!unsafeData.payload || typeof unsafeData.payload !== 'string') {
          console.debug('Invalid payload in data', unsafeData)
          return NOT_FOUND
        }
        const unsafePayload = JSON.parse(unsafeData.payload)
        if (
          !unsafePayload ||
          typeof unsafePayload !== 'object' ||
          !unsafePayload.api_app_id ||
          typeof unsafePayload.api_app_id !== 'string'
        ) {
          console.debug('No app ID in payload', unsafePayload)
          return NOT_FOUND
        }
        const appId = unsafePayload.api_app_id

        if (appId === SLACK_APP_ID) {
          const data = await getVerifiedData(req)
          if (!data.success) {
            console.warn(
              `Signature verification failed for interaction:`,
              unsafeData
            )
            return NOT_FOUND
          }

          const interaction = unsafePayload as SlackAction

          handleCoreInteraction(interaction)
        } else {
          const workflow = await getWorkflowByAppId(appId)
          if (!workflow) {
            console.warn('Request to unknown app', unsafePayload)
            return NOT_FOUND
          }

          const data = await getVerifiedData(req, workflow.signing_secret)
          if (!data.success) {
            console.warn(
              `Signature verification failed for interaction:`,
              unsafeData
            )
            return NOT_FOUND
          }

          const interaction = unsafePayload as SlackAction

          return handleInteraction(interaction)
        }

        return new Response()
      },
    },

    '/oauth/callback': {
      GET: async (req) => {
        const query = new URL(req.url).searchParams
        const code = query.get('code')
        const appId = query.get('state')
        if (!code || !appId) {
          return new Response('Invalid request', { status: 400 })
        }

        const workflow = await getWorkflowByAppId(appId)
        if (!workflow) {
          return new Response('The workflow is not found', { status: 400 })
        }

        let token: string
        try {
          const res = await slack.oauth.v2.access({
            client_id: workflow.client_id,
            client_secret: workflow.client_secret,
            code,
          })
          token = res.access_token!
        } catch (e) {
          console.error('Error redeeming code for token', e)
          return new Response(
            "The OAuth code is invalid. Please try clicking the authentication link in @Winterflows's App Home again. If the problem persists, please contact the devs for assistance.",
            { status: 400 }
          )
        }

        workflow.access_token = token
        await updateWorkflow(workflow)

        return Response.redirect(
          await getDMLink(workflow.creator_user_id, token)
        )
      },
    },

    '/workflow/:id': async (req) => {
      const id = parseInt(req.params.id)
      if (isNaN(id)) return new Response('Workflow not found', { status: 404 })
      const workflow = await getWorkflowById(id)
      if (!workflow) return new Response('Workflow not found', { status: 404 })
      if (!workflow.access_token)
        return new Response(
          'This workflow is not installed yet. Please contact the creator to authenticate it.'
        )
      return Response.redirect(await getUserLink(workflow.access_token))
    },

    '/api/v1/workflows': {
      GET: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        return workflowApi.listWorkflows(user, new URL(req.url).searchParams)
      },
      POST: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        const body = await req.json()
        return workflowApi.createWorkflow(user, body)
      },
    },

    '/api/v1/workflows/:id': {
      GET: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        const id = parseInt(req.params.id)
        if (isNaN(id)) return NOT_FOUND
        return workflowApi.getWorkflow(user, id)
      },
      PATCH: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        const id = parseInt(req.params.id)
        if (isNaN(id)) return NOT_FOUND
        const body = await req.json()
        return workflowApi.patchWorkflow(user, id, body)
      },
      DELETE: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        const id = parseInt(req.params.id)
        if (isNaN(id)) return NOT_FOUND
        return workflowApi.deleteWorkflow(user, id, new URL(req.url).searchParams)
      },
    },

    '/api/v1/workflows/:id/executions': {
      GET: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        const id = parseInt(req.params.id)
        if (isNaN(id)) return NOT_FOUND
        return executionApi.listWorkflowExecutions(user, id, new URL(req.url).searchParams)
      },
    },

    '/api/v1/executions/:execution_id': {
      GET: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        const id = parseInt(req.params.execution_id)
        if (isNaN(id)) return NOT_FOUND
        return executionApi.getExecution(user, id)
      },
    },

    '/api/v1/executions/:execution_id/cancel': {
      POST: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        const id = parseInt(req.params.execution_id)
        if (isNaN(id)) return NOT_FOUND
        return executionApi.cancelExecution(user, id)
      },
    },

    '/api/v1/workflows/:id/trigger': {
      GET: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        const id = parseInt(req.params.id)
        if (isNaN(id)) return NOT_FOUND
        return triggerApi.getWorkflowTriggerEndpoint(user, id)
      },
      PUT: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        const id = parseInt(req.params.id)
        if (isNaN(id)) return NOT_FOUND
        const body = await req.json()
        return triggerApi.updateWorkflowTrigger(user, id, body)
      },
      DELETE: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        const id = parseInt(req.params.id)
        if (isNaN(id)) return NOT_FOUND
        return triggerApi.deleteWorkflowTrigger(user, id)
      },
    },

    '/api/v1/steps/types': {
      GET: async () => {
        return metadataApi.listStepTypes()
      },
    },

    '/api/v1/workflows/:id/stats': {
      GET: async (req) => {
        const user = await authenticateRequest(req)
        if (!user) return unauthorizedResponse()
        const id = parseInt(req.params.id)
        if (isNaN(id)) return NOT_FOUND
        return metadataApi.getWorkflowStats(user, id, new URL(req.url).searchParams)
      },
    },
  },
  port: PORT,
})

setInterval(getActiveConfigToken, 30 * 60 * 1000)
getActiveConfigToken()
timeTriggerTask()
cronTriggerTask()

console.log(`Server started on http://localhost:${PORT}`)
