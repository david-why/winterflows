import type { WorkflowStepMap } from './steps'

export interface WorkflowStep<Type extends keyof WorkflowStepMap> {
  id: string
  type_id: Type
  inputs: {
    [K in keyof WorkflowStepMap[Type]['inputs']]: string
  }
}
