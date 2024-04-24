import {
  type AwilixContainer,
  type BuildResolver,
  type BuildResolverOptions,
  type Constructor,
  type DisposableResolver,
  asClass,
} from 'awilix'
import type { Resolver } from 'awilix/lib/resolvers'

declare module 'awilix' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ResolverOptions<T> {
    asyncInit?: boolean | string
    asyncInitPriority?: number // lower means it gets initted earlier
    asyncDispose?: boolean | string | (<U extends T>(instance: U) => Promise<unknown>)
    asyncDisposePriority?: number // lower means it gets disposed earlier
    eagerInject?: boolean | string
    tags?: string[]
    enabled?: boolean
  }
}

export type AwilixManagerConfig = {
  diContainer: AwilixContainer
  asyncInit?: boolean
  asyncDispose?: boolean
  eagerInject?: boolean
  strictBooleanEnforced?: boolean
}

export function asMockClass<T = object>(
  Type: unknown,
  opts?: BuildResolverOptions<T>,
): BuildResolver<T> & DisposableResolver<T> {
  return asClass(Type as Constructor<T>, opts)
}

export class AwilixManager {
  public readonly config: AwilixManagerConfig

  constructor(config: AwilixManagerConfig) {
    this.config = config
    if (config.strictBooleanEnforced) {
      for (const entry of Object.entries(config.diContainer.registrations)) {
        const [dependencyName, config] = entry
        if ('enabled' in config && config.enabled !== true && config.enabled !== false) {
          throw new Error(
            `Invalid config for ${dependencyName}. "enabled" field can only be set to true or false, or omitted`,
          )
        }
      }
    }
  }

  async executeInit() {
    if (this.config.eagerInject) {
      eagerInject(this.config.diContainer)
    }

    if (this.config.asyncInit) {
      await asyncInit(this.config.diContainer)
    }
  }

  async executeDispose() {
    await asyncDispose(this.config.diContainer)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getWithTags(diContainer: AwilixContainer, tags: string[]): Record<string, any> {
    return getWithTags(diContainer, tags)
  }
}

export async function asyncInit(diContainer: AwilixContainer) {
  const dependenciesWithAsyncInit = Object.entries(diContainer.registrations)
    .filter((entry) => {
      return entry[1].asyncInit && entry[1].enabled !== false
    })
    .sort((entry1, entry2) => {
      const [key1, resolver1] = entry1
      const [key2, resolver2] = entry2
      const asyncInitPriority1 = resolver1.asyncInitPriority ?? 1
      const asyncInitPriority2 = resolver2.asyncInitPriority ?? 1

      if (asyncInitPriority1 !== asyncInitPriority2) {
        return asyncInitPriority1 - asyncInitPriority2
      }

      return key1.localeCompare(key2)
    })

  for (const entry of dependenciesWithAsyncInit) {
    const resolvedValue = diContainer.resolve(entry[0])
    if (entry[1].asyncInit === true) {
      await resolvedValue.asyncInit(diContainer.cradle)
    } else {
      // @ts-ignore
      await resolvedValue[entry[1].asyncInit](diContainer.cradle)
    }
  }
}

export function eagerInject(diContainer: AwilixContainer) {
  const dependenciesWithEagerInject = Object.entries(diContainer.registrations).filter((entry) => {
    return entry[1].eagerInject && entry[1].enabled !== false
  })

  for (const entry of dependenciesWithEagerInject) {
    const resolvedComponent = diContainer.resolve(entry[0])
    if (typeof entry[1].eagerInject === 'string') {
      resolvedComponent[entry[1].eagerInject]()
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getWithTags(diContainer: AwilixContainer, tags: string[]): Record<string, any> {
  const dependenciesWithTags = Object.entries(diContainer.registrations).filter((entry) => {
    return (
      entry[1].enabled !== false && tags.every((v) => entry[1].tags && entry[1].tags.includes(v))
    )
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolvedComponents: Record<string, any> = {}
  for (const entry of dependenciesWithTags) {
    resolvedComponents[entry[0]] = diContainer.resolve(entry[0])
  }

  return resolvedComponents
}

export async function asyncDispose(diContainer: AwilixContainer) {
  const dependenciesWithAsyncDispose = Object.entries(diContainer.registrations)
    .filter((entry) => {
      return entry[1].asyncDispose && entry[1].enabled !== false
    })
    .sort((entry1, entry2) => {
      const [key1, resolver1] = entry1
      const [key2, resolver2] = entry2
      const asyncDisposePriority1 = resolver1.asyncDisposePriority ?? 1
      const asyncDisposePriority2 = resolver2.asyncDisposePriority ?? 1

      if (asyncDisposePriority1 !== asyncDisposePriority2) {
        return asyncDisposePriority1 - asyncDisposePriority2
      }

      return key1.localeCompare(key2)
    })

  for (const entry of dependenciesWithAsyncDispose) {
    const resolvedValue = diContainer.resolve(entry[0])

    const asyncDispose = entry[1].asyncDispose

    if (typeof asyncDispose === 'function') {
      await asyncDispose(resolvedValue)
      continue
    }

    if (asyncDispose === true) {
      await resolvedValue.asyncDispose()
      continue
    }
    // @ts-ignore
    await resolvedValue[asyncDispose]()
  }
}
