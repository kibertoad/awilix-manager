import {
  type AwilixContainer,
  asClass,
  asFunction,
  asValue,
  type BuildResolver,
  type BuildResolverOptions,
  type Constructor,
  type DisposableResolver,
} from 'awilix'
import type { FunctionReturning } from 'awilix/lib/container'
import type { Resolver } from 'awilix/lib/resolvers'
import { pMap } from './pMap'

type AsyncInitFunction<T> = <U extends T>(
  instance: U,
  diContainer: AwilixContainer<any>,
) => Promise<unknown>

type AsyncInitMethod<T> = boolean | string | AsyncInitFunction<T>

type AsyncInitConfig<T> = {
  method?: AsyncInitMethod<T>
} & (
  | { nonBlocking?: boolean; concurrent?: false }
  | {
      nonBlocking?: false
      // Runs alongside the other inits of the same priority instead of after them. Lower priorities
      // still finish before it starts, and it finishes before any higher priority starts.
      concurrent?: boolean
    }
)

declare module 'awilix' {
  interface ResolverOptions<T> {
    asyncInit?: AsyncInitMethod<T> | AsyncInitConfig<T>
    asyncInitPriority?: number // lower means it gets initted earlier
    asyncDispose?: boolean | string | (<U extends T>(instance: U) => Promise<unknown>)
    asyncDisposePriority?: number // lower means it gets disposed earlier
    eagerInject?: boolean | string
    tags?: string[]
    enabled?: boolean
  }
}

export type Logger = (message: string) => void

export type NonBlockingInitErrorHandler = (dependencyName: string, error: unknown) => void

export type AwilixManagerConfig = {
  diContainer: AwilixContainer
  asyncInit?: boolean
  asyncDispose?: boolean
  eagerInject?: boolean
  strictBooleanEnforced?: boolean
  enableDebugLogging?: boolean
  loggerFn?: Logger
  onNonBlockingInitError?: NonBlockingInitErrorHandler
  maxConcurrency?: number
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

  async executeInit(): Promise<void> {
    if (this.config.eagerInject) {
      eagerInject(this.config.diContainer)
    }

    if (this.config.asyncInit) {
      await asyncInit(this.config.diContainer, {
        enableDebugLogging: this.config.enableDebugLogging,
        loggerFn: this.config.loggerFn,
        onNonBlockingInitError: this.config.onNonBlockingInitError,
        maxConcurrency: this.config.maxConcurrency,
      })
    }
  }

  async executeDispose(): Promise<void> {
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
  // Receives the rejection of a `nonBlocking` init, which nothing else awaits. Defaults to console.error.
  onNonBlockingInitError?: NonBlockingInitErrorHandler
  // How many `concurrent` inits of one priority may run at the same time. Defaults to no limit.
  maxConcurrency?: number
}

function isAsyncInitConfig(value: any): value is AsyncInitConfig<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('method' in value || 'nonBlocking' in value || 'concurrent' in value)
  )
}

function getAsyncInitMethod(asyncInit: any): AsyncInitMethod<unknown> {
  if (isAsyncInitConfig(asyncInit)) {
    // If method is not specified, default to true (use default asyncInit method)
    return asyncInit.method ?? true
  }
  return asyncInit
}

function isNonBlocking(asyncInit: any): boolean {
  return isAsyncInitConfig(asyncInit) && asyncInit.nonBlocking === true
}

function isConcurrent(asyncInit: any): boolean {
  return isAsyncInitConfig(asyncInit) && asyncInit.concurrent === true
}

function logNonBlockingInitError(dependencyName: string, error: unknown): void {
  console.error(`asyncInit: ${dependencyName} - failed (non-blocking)`, error)
}

type AsyncInitEntry = [string, Resolver<any>]

function groupByPriority(sortedEntries: AsyncInitEntry[]): AsyncInitEntry[][] {
  const groups: AsyncInitEntry[][] = []
  let currentPriority: number | undefined
  for (const entry of sortedEntries) {
    const priority = entry[1].asyncInitPriority ?? 1
    if (groups.length === 0 || priority !== currentPriority) {
      groups.push([])
      currentPriority = priority
    }
    groups[groups.length - 1].push(entry)
  }
  return groups
}

function validateAsyncInitConfig(entries: AsyncInitEntry[], maxConcurrency: number): void {
  if (
    !(
      (Number.isSafeInteger(maxConcurrency) && maxConcurrency >= 1) ||
      maxConcurrency === Number.POSITIVE_INFINITY
    )
  ) {
    throw new TypeError(
      `Expected maxConcurrency to be an integer from 1 and up or Infinity, got ${maxConcurrency}`,
    )
  }

  for (const [key, description] of entries) {
    if (isNonBlocking(description.asyncInit) && isConcurrent(description.asyncInit)) {
      throw new Error(
        `Invalid asyncInit config for ${key}: "nonBlocking" and "concurrent" cannot both be set`,
      )
    }
  }
}

type PriorityGroupContext = {
  diContainer: AwilixContainer
  logDebug: Logger
  onNonBlockingInitError: NonBlockingInitErrorHandler
  maxConcurrency: number
}

async function initPriorityGroup(
  priorityGroup: AsyncInitEntry[],
  { diContainer, logDebug, onNonBlockingInitError, maxConcurrency }: PriorityGroupContext,
): Promise<void> {
  // The first failure of the priority, in the order failures happen. A concurrent init records its
  // rejection as soon as it lands, so it is handled even while a sequential init is still awaited.
  let failure: { error: unknown } | undefined
  const recordFailure = (error: unknown) => {
    failure ??= { error }
  }

  const startInit = (key: string, description: Resolver<any>): Promise<void> => {
    logDebug(`asyncInit: ${key} - started`)

    const resolvedValue = diContainer.resolve(key)
    const method = getAsyncInitMethod(description.asyncInit)

    // Validate method existence synchronously before starting async init
    validateAsyncInitMethod(resolvedValue, method, key)

    return executeAsyncInitMethod(resolvedValue, method, key, diContainer)
  }

  // The mapper never throws, so pMap resolves only once every concurrent init it started has
  // settled. An init still waiting for a slot when a failure is recorded is never started.
  const concurrentInits = pMap(
    priorityGroup.filter(([, description]) => isConcurrent(description.asyncInit)),
    async ([key, description]) => {
      if (failure) {
        return
      }
      try {
        await startInit(key, description)
        logDebug(`asyncInit: ${key} - finished (concurrent)`)
      } catch (error) {
        recordFailure(error)
      }
    },
    { concurrency: maxConcurrency },
  )

  try {
    for (const [key, description] of priorityGroup) {
      if (failure) {
        break
      }
      if (isConcurrent(description.asyncInit)) {
        continue
      }

      const initPromise = startInit(key, description)

      if (isNonBlocking(description.asyncInit)) {
        initPromise
          .then(() => logDebug(`asyncInit: ${key} - finished (non-blocking)`))
          .catch((error: unknown) => onNonBlockingInitError(key, error))
      } else {
        await initPromise
        logDebug(`asyncInit: ${key} - finished`)
      }
    }
  } catch (error) {
    recordFailure(error)
  }

  // Concurrent inits that are already running are waited for even after a failure, so that
  // nothing is still initializing when the caller reacts to the error, e.g. by disposing.
  await concurrentInits
  if (failure) {
    throw failure.error
  }
}

export async function asyncInit(
  diContainer: AwilixContainer,
  options: AsyncInitOptions = {},
): Promise<void> {
  const {
    enableDebugLogging,
    loggerFn = console.log,
    onNonBlockingInitError = logNonBlockingInitError,
    maxConcurrency = Number.POSITIVE_INFINITY,
  } = options

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

  validateAsyncInitConfig(dependenciesWithAsyncInit, maxConcurrency)

  const logDebug = (message: string) => {
    if (enableDebugLogging) {
      loggerFn(message)
    }
  }

  for (const priorityGroup of groupByPriority(dependenciesWithAsyncInit)) {
    await initPriorityGroup(priorityGroup, {
      diContainer,
      logDebug,
      onNonBlockingInitError,
      maxConcurrency,
    })
  }
}

function validateAsyncInitMethod(
  resolvedValue: any,
  method: AsyncInitMethod<unknown>,
  key: string,
): void {
  if (method === true) {
    if (!('asyncInit' in resolvedValue)) {
      throw new Error(`Method asyncInit does not exist on dependency ${key}`)
    }
  } else if (typeof method === 'string') {
    // custom method name
    if (!(method in resolvedValue)) {
      throw new Error(`Method ${method} for asyncInit does not exist on dependency ${key}`)
    }
  }
}

async function executeAsyncInitMethod(
  resolvedValue: any,
  method: AsyncInitMethod<unknown>,
  _key: string,
  diContainer: AwilixContainer,
): Promise<void> {
  // use default asyncInit method
  if (method === true) {
    await resolvedValue.asyncInit(diContainer.cradle)
  } else if (typeof method === 'function') {
    // use function asyncInit
    await method(resolvedValue, diContainer)
  } else if (typeof method === 'string') {
    // use custom method name
    await resolvedValue[method](diContainer.cradle)
  }
}

export function eagerInject(diContainer: AwilixContainer<any>): void {
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

export function getWithTags(
  diContainer: AwilixContainer<any>,
  tags: string[],
): Record<string, any> {
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
  diContainer: AwilixContainer<any>,
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

export async function asyncDispose(diContainer: AwilixContainer<any>): Promise<void> {
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
    // @ts-expect-error
    await resolvedValue[asyncDispose]()
  }
}
