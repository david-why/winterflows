import { createTimeTrigger } from '../triggers/create'
import { registerTriggerFunction } from '../triggers/functions'
import type { ExecutionContext } from './context'
import { advanceWorkflow } from './execute'
import messagesSteps from './specs/messages'

export const PENDING = Symbol.for('Winterflows.PENDING')
export type PENDING = typeof PENDING

export type DataType = 'user' | 'channel' | 'text' | 'rich_text' | 'message'

export type StepFunction<
  Inputs extends Record<string, string> = Record<string, string>,
  Outputs extends Record<string, string> = Record<string, string>
> = (
  ctx: ExecutionContext,
  inputs: Inputs
) => Outputs | PENDING | Promise<Outputs | PENDING>

export type StepIOSpec<
  T extends Record<string, string> = Record<string, string>
> = {
  [K in keyof T]: {
    name: string
    type: DataType
    required: boolean
  }
}

type StepSpec<
  Inputs extends Record<string, string> = Record<string, string>,
  Outputs extends Record<string, string> = Record<string, string>
> = {
  name: string
  category: string
  inputs: StepIOSpec<Inputs>
  outputs: StepIOSpec<Outputs>
}

export type WorkflowStepSpec<
  Inputs extends Record<string, string> = Record<string, string>,
  Outputs extends Record<string, string> = Record<string, string>
> = {
  func: StepFunction<Inputs, Outputs>
} & StepSpec<Inputs, Outputs>

export function defineStep<
  Inputs extends Record<string, string> = Record<string, string>,
  Outputs extends Record<string, string> = Record<string, string>
>(
  func: StepFunction<Inputs, Outputs>,
  spec: StepSpec<Inputs, Outputs>
): WorkflowStepSpec<Inputs, Outputs> {
  return { func, ...spec }
}

// steps

async function delayWorkflow(ctx: ExecutionContext, { ms }: { ms: string }) {
  const time = parseFloat(ms)
  if (isNaN(time)) {
    throw new Error(`Failed to parse sleep duration \`${ms}\``)
  }
  await createTimeTrigger(Date.now() + time, {
    workflow_id: null,
    execution_id: ctx.execution.id,
    func: 'steps.delay.restart',
    details: ctx.step_id,
  })
  return PENDING
  return {}
}

registerTriggerFunction('steps.delay.restart', async (trigger) => {
  const stepId = trigger.details!
  await advanceWorkflow(trigger.execution_id!, stepId, {})
})

// end steps

const steps: Record<string, WorkflowStepSpec<any, any>> = {
  ...messagesSteps,
  delay: defineStep(delayWorkflow, {
    name: 'Delay execution',
    category: 'Utilities',
    inputs: {
      ms: { name: 'Time (in ms)', required: true, type: 'text' },
    },
    outputs: {},
  }),
}

export default steps
export type WorkflowStepMap = typeof steps
