import { sql } from 'bun'

export interface WorkflowVersion {
  id: number
  workflow_id: number
  steps: string
  created_at: number
}

export async function getLatestWorkflowVersion(workflowId: number) {
  const result = await sql<
    WorkflowVersion[]
  >`SELECT * FROM workflow_versions WHERE workflow_id = ${workflowId} ORDER BY created_at DESC LIMIT 1`
  return result[0]
}

export async function getWorkflowVersionById(id: number) {
  const result = await sql<
    WorkflowVersion[]
  >`SELECT * FROM workflow_versions WHERE id = ${id}`
  return result[0]
}

export async function addWorkflowVersion(
  version: Omit<WorkflowVersion, 'id' | 'created_at'>
) {
  const payload = { ...version, created_at: Date.now() }
  const result = await sql<
    [WorkflowVersion]
  >`INSERT INTO workflow_versions ${sql(payload)} RETURNING *`
  return result[0]
}
