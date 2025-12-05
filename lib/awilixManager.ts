import {
  type AwilixContainer,
  type BuildResolver,
  type BuildResolverOptions,
  type Constructor,
  type DisposableResolver,
  asClass,
  asFunction,
  asValue,
} from 'awilix'
import type { FunctionReturning } from 'awilix/lib/container'
import type { Resolver } from 'awilix/lib/resolvers'

declare module 'awilix' {
  interface ResolverOptions<T> {
    asyncInit?:
      | boolean
      | string
      | (<U extends T>(instance: U, diContainer: AwilixContainer) => Promise<unknown>)
    asyncInitPriority?: number // lower means it gets initted earlier
    asyncDispose?: boolean | string | (<U extends T>(instance: U) => Promise<unknown>)
    asyncDisposePriority?: number // lower means it gets disposed earlier
    eagerInject?: boolean | string
    tags?: string[]
    enabled?: boolean
  }
}

export type Logger = (message: string) => void

export type AwilixManagerConfig = {
  diContainer: AwilixContainer
  asyncInit?: boolean
  asyncDispose?: boolean
  eagerInject?: boolean
  strictBooleanEnforced?: boolean
  enableDebugLogging?: boolean
  loggerFn?: Logger
}

export function asMockClass<T = object>(
  Type: unknown,
  opts?: BuildResolverOptions<T>,
): BuildResolver<T> & DisposableResolver<T> {
  return asClass(Type as Constructor<T>, opts)
}

export function asMockValue<T = object>(value: unknown): Resolver<T> {
  return asValue(value as T)
}

export function asMockFunction<T = object>(
  fn: FunctionReturning<unknown>,
  opts?: BuildResolverOptions<T>,
): BuildResolver<T> & DisposableResolver<T> {
  return asFunction(fn as FunctionReturning<T>, opts)
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
      await asyncInit(this.config.diContainer, {
        enableDebugLogging: this.config.enableDebugLogging,
        loggerFn: this.config.loggerFn,
      })
    }
  }

  async executeDispose() {
    await asyncDispose(this.config.diContainer)
  }

  getWithTags(tags: string[]): Record<string, any> {
    return getWithTags(this.config.diContainer, tags)
  }

  getByPredicate(predicate: (entity: any) => boolean): Record<string, any> {
    return getByPredicate(this.config.diContainer, predicate)
  }
}

export type AsyncInitOptions = {
  enableDebugLogging?: boolean
  loggerFn?: Logger
}

export async function asyncInit(diContainer: AwilixContainer, options: AsyncInitOptions = {}) {
  const { enableDebugLogging, loggerFn = console.log } = options

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

  for (const [key, description] of dependenciesWithAsyncInit) {
    if (enableDebugLogging) {
      loggerFn(`asyncInit: ${key} - started`)
    }

    const resolvedValue = diContainer.resolve(key)

    // use default asyncInit method
    if (description.asyncInit === true) {
      if (!('asyncInit' in resolvedValue)) {
        throw new Error(`Method asyncInit does not exist on dependency ${key}`)
      }
      await resolvedValue.asyncInit(diContainer.cradle)
    } else if (typeof description.asyncInit === 'function') {
      // use function asyncInit
      await description.asyncInit(resolvedValue, diContainer)
    } else {
      // use custom method name
      // @ts-expect-error
      if (!(description.asyncInit in resolvedValue)) {
        throw new Error(
          `Method ${description.asyncInit} for asyncInit does not exist on dependency ${key}`,
        )
      }
      // @ts-expect-error
      await resolvedValue[description.asyncInit](diContainer.cradle)
    }

    if (enableDebugLogging) {
      loggerFn(`asyncInit: ${key} - finished`)
    }
  }
}

export function eagerInject(diContainer: AwilixContainer) {
  const dependenciesWithEagerInject = Object.entries(diContainer.registrations).filter(
    ([_key, description]) => {
      return description.eagerInject && description.enabled !== false
    },
  )

  for (const [key, description] of dependenciesWithEagerInject) {
    const resolvedComponent = diContainer.resolve(key)
    if (typeof description.eagerInject === 'string') {
      resolvedComponent[description.eagerInject]()
    }
  }
}

export function getWithTags(diContainer: AwilixContainer, tags: string[]): Record<string, any> {
  const dependenciesWithTags = Object.entries(diContainer.registrations).filter(
    ([_key, description]) => {
      return (
        description.enabled !== false &&
        tags.every((v) => description.tags && description.tags.includes(v))
      )
    },
  )

  const resolvedComponents: Record<string, any> = {}
  for (const [key] of dependenciesWithTags) {
    resolvedComponents[key] = diContainer.resolve(key)
  }

  return resolvedComponents
}

export function getByPredicate(
  diContainer: AwilixContainer,
  predicate: (entity: any) => boolean,
): Record<string, any> {
  const enabledDependencies = Object.entries(diContainer.registrations).filter(
    ([_key, description]) => {
      return description.enabled !== false
    },
  )

  const resolvedComponents: Record<string, any> = {}
  for (const [key] of enabledDependencies) {
    const resolvedElement = diContainer.resolve(key)
    if (predicate(resolvedElement)) {
      resolvedComponents[key] = resolvedElement
    }
  }

  return resolvedComponents
}

export async function asyncDispose(diContainer: AwilixContainer) {
  const dependenciesWithAsyncDispose = Object.entries(diContainer.registrations)
    .filter(([_key, description]) => {
      return description.asyncDispose && description.enabled !== false
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

  for (const [key, description] of dependenciesWithAsyncDispose) {
    const resolvedValue = diContainer.resolve(key)

    const asyncDispose = description.asyncDispose

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
