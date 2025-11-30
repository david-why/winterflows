import type { RespondArguments } from '@slack/bolt'
import type {
  RichTextBlock,
  RichTextBlockElement,
  RichTextElement,
  RichTextStyleable,
} from '@slack/types'
import type { AppsManifestCreateArguments } from '@slack/web-api'
import slack from '../clients/slack'
import { getConfigToken, updateConfigToken } from '../database/config_tokens'
import { WORKFLOW_APP_SCOPES } from '../consts'

const { EXTERNAL_URL } = process.env

export type ManifestEvent =
  (((AppsManifestCreateArguments['manifest']['settings'] & {})['event_subscriptions'] & {})['bot_events'] & {})[number]

export function generateManifest(
  name: string,
  additionalEvents: ManifestEvent[] = []
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
        bot_events: ['app_home_opened', ...additionalEvents],
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

export async function respond(
  event: { response_url: string },
  data: string | RespondArguments
) {
  const isText = typeof data === 'string'
  const contentType = isText ? 'text/plain' : 'application/json'
  const body = isText ? data : JSON.stringify(data)

  return await fetch(event.response_url, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': contentType,
    },
  })
}

export async function getActiveConfigToken() {
  const token = await getConfigToken()
  if (!token) return
  if (token.expires_at > Date.now()) return token.access_token
  try {
    const res = await slack.tooling.tokens.rotate({
      refresh_token: token.refresh_token,
    })
    token.access_token = res.token!
    token.refresh_token = res.refresh_token!
    token.expires_at = res.exp! * 1000
  } catch (e) {
    console.error('Failed to rotate app config token:', e)
    return
  }
  await updateConfigToken(token)
  console.log('Successfully rotated config token!')
  return token.access_token
}

export function replaceRichText(
  block: RichTextBlock,
  replacements: Record<string, string>
) {
  for (const element of block.elements) {
    replaceRichTextBlockElement(element, replacements)
  }
  return block
}

function replaceRichTextBlockElement(
  element: RichTextBlockElement,
  replacements: Record<string, string>
) {
  const elements: RichTextElement[] = []
  switch (element.type) {
    case 'rich_text_list':
      for (const section of element.elements)
        replaceRichTextBlockElement(section, replacements)
      break
    case 'rich_text_preformatted':
    case 'rich_text_quote':
    case 'rich_text_section':
    default:
      for (const ele of element.elements)
        elements.push(...replaceRichTextElement(ele, replacements))
      element.elements = elements
      break
  }
}

function replaceRichTextElement(
  element: RichTextElement,
  replacements: Record<string, string>
): RichTextElement[] {
  if (element.type !== 'link' && element.type !== 'text') return [element]

  let elements: RichTextElement[] = [element]

  if (element.type === 'text') {
    // allow user and channel pings to work here
    for (const [old, repl] of Object.entries(replacements)) {
      let match: RegExpMatchArray | null
      let replElement: RichTextElement | null = null
      if ((match = repl.match(/^<@(U[0-9A-Z]+)>$/))) {
        const userId = match[1]!
        replElement = { type: 'user', user_id: userId }
      } else if ((match = repl.match(/^<#(C[0-9A-Z]+)>$/))) {
        const channelId = match[1]!
        replElement = { type: 'channel', channel_id: channelId }
      }
      if (!replElement) continue

      const newElements: RichTextElement[] = []
      for (const element of elements) {
        if (element.type !== 'text') {
          newElements.push(element)
          continue
        }
        let index: number = -1
        let text = element.text
        while ((index = text.indexOf(old)) >= 0) {
          const before = text.substring(0, index)
          const after = text.substring(index + old.length)
          console.log(before, replElement, after)
          if (before)
            newElements.push({
              type: 'text',
              text: before,
              style: element.style,
            })
          newElements.push(replElement)
          text = after
        }
        if (text) newElements.push({ type: 'text', text, style: element.style })
      }

      elements = newElements
    }
  }

  elements = normalizeRichTextElements(elements)

  for (const element of elements)
    if (element.type === 'text')
      element.text = element.text && replaceText(element.text, replacements)
  return elements
}

export function replaceText(
  text: string,
  replacements: Record<string, string>
) {
  for (const [old, repl] of Object.entries(replacements))
    text = text.replaceAll(old, repl)
  return text
}

export function normalizeRichTextElements(
  elements: RichTextElement[]
): RichTextElement[] {
  const newElements: RichTextElement[] = []

  for (const element of elements) {
    if (newElements.length) {
      const lastElement = newElements[newElements.length - 1]!
      if (
        lastElement.type === 'text' &&
        element.type === 'text' &&
        areStylesEqual(lastElement.style, element.style)
      ) {
        lastElement.text += element.text
        continue
      }
    }
    newElements.push({ ...element })
  }

  return newElements
}

function areStylesEqual(
  left: RichTextStyleable['style'],
  right: RichTextStyleable['style']
) {
  if (!left) return !right
  if (!right) return !left
  return (
    left.bold === right.bold &&
    left.code === right.code &&
    left.italic === right.italic &&
    left.strike === right.strike &&
    left.underline === right.underline
  )
}

export function addTextToRichTextBlock(block: RichTextBlock, text: string) {
  if (!block.elements.length)
    block.elements.push({ type: 'rich_text_section', elements: [] })

  const blockElement = block.elements[block.elements.length - 1]!
  if (blockElement.type === 'rich_text_list') {
    if (!blockElement.elements.length)
      blockElement.elements.push({ type: 'rich_text_section', elements: [] })
    const section = blockElement.elements[blockElement.elements.length - 1]!
    section.elements.push({ type: 'text', text })
    section.elements = normalizeRichTextElements(section.elements)
  } else {
    blockElement.elements.push({ type: 'text', text })
    blockElement.elements = normalizeRichTextElements(blockElement.elements)
  }

  return block
}
