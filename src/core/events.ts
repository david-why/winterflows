import type { EnvelopedEvent } from '@slack/bolt'
import type { KnownBlock, LinkUnfurls, SlackEvent } from '@slack/types'
import slack from '../clients/slack'
import { getWorkflowById } from '../database/workflows'
import { generateWorkflowView } from '../workflows/blocks'

const { SLACK_BOT_TOKEN } = process.env

export async function handleCoreEvent({
  event,
}: {
  event: SlackEvent
  envelope: EnvelopedEvent
}) {
  if (event.type === 'link_shared') {
    if (!event.unfurl_id) return

    const unfurls: LinkUnfurls = {}
    for (const link of event.links) {
      const path = new URL(link.url).pathname
      const match = path.match(/^\/workflow\/([0-9]+)$/)
      if (match) {
        const id = parseInt(match[1]!)
        const workflow = await getWorkflowById(id)
        if (!workflow) continue
        const blocks: KnownBlock[] = await generateWorkflowView(workflow)
        unfurls[link.url] = { blocks }
      }
    }

    await slack.chat.unfurl({
      token: SLACK_BOT_TOKEN,
      channel: event.channel,
      ts: event.message_ts,
      unfurls,
    })
  }
}
