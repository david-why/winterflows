import { createTimeTrigger } from '../../triggers/create'
import { registerTriggerFunction } from '../../triggers/functions'
import type { ExecutionContext } from '../context'
import { advanceWorkflow } from '../execute'

export const PENDING = Symbol.for('Winterflows.PENDING')
export type PENDING = typeof PENDING

export type DataType =
  | 'user'
  | 'channel'
  | 'text'
  | 'rich_text'
  | 'message'
  | 'usergroup'

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
    description?: string
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

import channelSteps from './channels'
import formsSteps from './forms'
import messagesSteps from './messages'
import usersSteps from './users'
import utilitiesSteps from './utilities'
import convertSteps from './convert'

// end steps

const steps: Record<string, WorkflowStepSpec<any, any>> = {
  ...messagesSteps,
  ...formsSteps,
  ...channelSteps,
  ...usersSteps,
  ...utilitiesSteps,
  ...convertSteps,
}

export default steps
export type WorkflowStepMap = typeof steps
