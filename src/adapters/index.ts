import { chatgpt } from './chatgpt'
import { claude } from './claude'
import { generic } from './generic'
import { muse } from './muse'
import type { AdapterSpec } from './types'

const registry: Record<string, AdapterSpec> = { claude, chatgpt, muse, generic }

export function adapterFor(name: string | null): AdapterSpec {
  return (name && registry[name]) || generic
}
