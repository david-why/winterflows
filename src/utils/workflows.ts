import type { Workflow } from '../database/workflows'
import type { WorkflowStep } from '../workflows/execute'

export function getWorkflowSteps(workflow: Workflow): WorkflowStep<any>[] {
  return JSON.parse(workflow.steps)
}
