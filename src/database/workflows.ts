import { sql } from 'bun'

export interface Workflow {
  id: number
  name: string
  description: string
  creator_user_id: string
  app_id: string
  client_id: string
  client_secret: string
  signing_secret: string
  access_token: string | null
  steps: string
  list_id: string | null
  canvas_id: string | null
}

export async function getWorkflowById(id: number) {
  const result = await sql<Workflow[]>`SELECT * FROM workflows WHERE id = ${id}`
  return result[0]
}

export async function getWorkflowByAppId(appId: string) {
  const result = await sql<
    Workflow[]
  >`SELECT * FROM workflows WHERE app_id = ${appId}`
  return result[0]
}

export async function getWorkflowsByCreator(creatorUserId: string) {
  const result = await sql<
    Workflow[]
  >`SELECT * FROM workflows WHERE creator_user_id = ${creatorUserId} ORDER BY id DESC`
  return result
}

export async function addWorkflow(
  workflow: Omit<
    Workflow,
    'id' | 'steps' | 'description' | 'list_id' | 'canvas_id'
  >
) {
  const result = await sql<[Workflow]>`INSERT INTO workflows ${sql(
    workflow
  )} RETURNING *`
  return result[0]
}

export async function updateWorkflow(workflow: Workflow) {
  const payload = { ...workflow, id: undefined }
  await sql`UPDATE workflows SET ${sql(payload)} WHERE id = ${workflow.id}`
}

export async function deleteWorkflowById(id: number) {
  await sql`DELETE FROM workflows WHERE id = ${id}`
}
