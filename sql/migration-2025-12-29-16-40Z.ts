// yes this is not a sql file, deal with it

import { sql } from 'bun'
import type { WorkflowExecution } from '../src/database/workflow_executions'
import type { Workflow } from '../src/database/workflows'

await sql.transaction(async (sql) => {
  try {
    const workflows = await sql<Workflow[]>`SELECT * FROM workflows`

    const newExecutions: (Omit<WorkflowExecution, 'workflow_id' | 'steps'> & {
      version_id: number
    })[] = []

    await sql`
    CREATE TABLE workflow_versions (
      id INTEGER PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY,
      workflow_id INTEGER NOT NULL,
      steps TEXT NOT NULL,
      created_at REAL NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE CASCADE
    )
  `
    await sql`CREATE INDEX idx_workflow_versions_workflow_id ON workflow_versions (workflow_id)`
    await sql`CREATE INDEX idx_workflow_versions_created_at ON workflow_versions (created_at)`

    for (const workflow of workflows) {
      const executions = await sql<
        WorkflowExecution[]
      >`SELECT * FROM workflow_executions WHERE workflow_id = ${workflow.id} ORDER BY id ASC`

      let lastSteps = null
      let lastVersionID = 0
      for (const execution of executions) {
        const steps = JSON.parse(execution.steps)

        if (!Bun.deepEquals(steps, lastSteps)) {
          const version = {
            workflow_id: workflow.id,
            steps: execution.steps,
            created_at: Date.now(),
          }

          const [{ id }] = await sql<
            [
              {
                id: number
              }
            ]
          >`INSERT INTO workflow_versions ${sql(version)} RETURNING id`

          lastSteps = steps
          lastVersionID = id
        }

        newExecutions.push({
          id: execution.id,
          trigger_id: execution.trigger_id,
          trigger_user_id: execution.trigger_user_id,
          step_index: execution.step_index,
          state: execution.state,
          version_id: lastVersionID,
        })
      }
    }

    await sql`ALTER TABLE workflow_executions DROP COLUMN steps`
    await sql`ALTER TABLE workflow_executions DROP COLUMN workflow_id`
    await sql`ALTER TABLE workflow_executions ADD COLUMN version_id INTEGER`
    await sql`ALTER TABLE workflow_executions ADD FOREIGN KEY (version_id) REFERENCES workflow_versions (id)`
    await sql`CREATE INDEX idx_workflow_executions_version_id ON workflow_executions (version_id)`

    for (const execution of newExecutions) {
      const payload = { ...execution, id: undefined }
      await sql`UPDATE workflow_executions SET ${sql(payload)} WHERE id = ${
        execution.id
      }`
    }

    await sql`ALTER TABLE workflow_executions ALTER COLUMN version_id SET NOT NULL`
  } catch (e) {
    console.error(e)
    throw e
  }
})
