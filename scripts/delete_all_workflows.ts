import { sql } from 'bun'
import { type Workflow } from '../src/database/workflows'
import slack from '../src/clients/slack'
import { getActiveConfigToken } from '../src/utils/slack'

const workflows = await sql<Workflow[]>`SELECT * FROM workflows`

for (const workflow of workflows) {
  if (workflow.access_token) {
    await slack.apps.uninstall({
      token: workflow.access_token,
      client_id: workflow.client_id,
      client_secret: workflow.client_secret,
    })
  }
  await slack.apps.manifest.delete({
    token: await getActiveConfigToken(),
    app_id: workflow.app_id,
  })
}

await sql`DELETE FROM workflows`
