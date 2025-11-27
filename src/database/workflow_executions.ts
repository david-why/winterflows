import { sql } from 'bun'

export interface WorkflowExecution {
  id: number
  workflow_id: number
  steps: string
  step_index: number
  state: string
}

export async function getWorkflowExecutionById(id: number) {
  const result = await sql<
    WorkflowExecution[]
  >`SELECT * FROM workflow_executions WHERE id = ${id}`
  return result[0]
}

export async function addWorkflowExecution(
  obj: Omit<WorkflowExecution, 'id' | 'step_index'>
) {
  const result = await sql<
    [WorkflowExecution]
  >`INSERT INTO workflow_executions ${sql(obj)} RETURNING *`
  return result[0]
}

export async function updateWorkflowExecution(obj: WorkflowExecution) {
  const payload = { ...obj, id: undefined }
  await sql`UPDATE workflow_executions SET ${sql(payload)} WHERE id = ${obj.id}`
}

export async function deleteWorkflowExecutionById(id: number) {
  await sql`DELETE FROM workflow_executions WHERE id = ${id}`
}
