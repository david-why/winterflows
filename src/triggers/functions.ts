import type { Trigger } from '../database/triggers'

export type TriggerFunction = (trigger: Trigger, data?: any) => unknown

const FUNCTIONS: Record<string, TriggerFunction> = {}

export function registerTriggerFunction(name: string, func: TriggerFunction) {
  FUNCTIONS[name] = func
}

export async function executeTriggerFunction(trigger: Trigger, data?: any) {
  const callback = FUNCTIONS[trigger.func]
  if (!callback) {
    throw new Error(`Callback function ${trigger.func} is undefined`)
  }
  return callback(trigger, data)
}
