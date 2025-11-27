import type { WorkflowStep } from '../workflows/execute'

export function getWorkflowSteps(workflow: {
  steps: string
}): WorkflowStep<any>[] {
  return JSON.parse(workflow.steps)
}
