import { SQL, sql } from 'bun'

export interface Trigger {
  id: number
  execution_id: number | null
  workflow_id: number | null
  type: string
  val_string: string | null
  val_number: number | null
  func: string
  details: string | null
}

export async function getTriggersByType(type: string) {
  const result = await sql<
    Trigger[]
  >`SELECT * FROM triggers WHERE type = ${type}`
  return result
}

export async function getTriggersByTypeAndString(type: string, name: string) {
  const result = await sql<
    Trigger[]
  >`SELECT * FROM triggers WHERE type = ${type} AND val_string = ${name}`
  return result
}

export async function getTriggersWhere(where: SQL.Query<any>) {
  const result = await sql<Trigger[]>`SELECT * FROM triggers WHERE ${where}`
  return result
}

export async function addTrigger(obj: Omit<Trigger, 'id'>) {
  const result = await sql<[Trigger]>`INSERT INTO triggers ${sql(
    obj
  )} RETURNING *`
  return result[0]
}

export async function deleteTriggerById(id: number) {
  await sql`DELETE FROM triggers WHERE id = ${id}`
}

export async function deleteTriggersByWorkflowId(workflowId: number) {
  await sql`DELETE FROM triggers WHERE workflow_id = ${workflowId}`
}
