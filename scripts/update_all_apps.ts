import { sql } from 'bun'
import type { Workflow } from '../src/database/workflows'
import slack from '../src/clients/slack'
import { generateManifest, getActiveConfigToken } from '../src/utils/slack'
import type { Trigger } from '../src/database/triggers'

const workflows = await sql<Workflow[]>`SELECT * FROM workflows`

const token = await getActiveConfigToken()

await Promise.allSettled(
  workflows.map(async (w) => {
    const trigger = (
      await sql<Trigger[]>`SELECT * FROM triggers WHERE workflow_id = ${w.id}`
    )[0]?.type

    await slack.apps.manifest.update({
      token,
      app_id: w.app_id,
      manifest: generateManifest(w.name, trigger),
    })
  })
)
