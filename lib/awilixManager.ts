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

type AsyncDisposeFunction<T> = <U extends T>(instance: U) => Promise<unknown>

type AsyncDisposeMethod<T> = boolean | string | AsyncDisposeFunction<T>

type AsyncDisposeConfig<T> = {
  method?: AsyncDisposeMethod<T>
  // Runs alongside the other disposes of the same priority instead of after them. Lower priorities
  // still finish before it starts, and it finishes before any higher priority starts.
  concurrent?: boolean
}

declare module 'awilix' {
  interface ResolverOptions<T> {
    asyncInit?: AsyncInitMethod<T> | AsyncInitConfig<T>
    asyncInitPriority?: number // lower means it gets initted earlier
    asyncDispose?: AsyncDisposeMethod<T> | AsyncDisposeConfig<T>
    asyncDisposePriority?: number // lower means it gets disposed earlier
    eagerInject?: boolean | string
    tags?: string[]
    enabled?: boolean
  }
}

export type Logger = (message: string) => void

export type DependencyErrorHandler = (
  dependencyName: string,
  error: unknown,
) => void | Promise<void>

/** @deprecated Use DependencyErrorHandler instead */
export type NonBlockingInitErrorHandler = DependencyErrorHandler

export type AwilixManagerConfig = {
  diContainer: AwilixContainer
  asyncInit?: boolean
  asyncDispose?: boolean
  eagerInject?: boolean
  strictBooleanEnforced?: boolean
  enableDebugLogging?: boolean
  loggerFn?: Logger
  onNonBlockingInitError?: DependencyErrorHandler
  maxConcurrency?: number
  onDisposeError?: DependencyErrorHandler
  maxDisposeConcurrency?: number
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

    if (config.maxConcurrency !== undefined) {
      validateMaxConcurrency(config.maxConcurrency, 'maxConcurrency')
    }
    // Checked here rather than in asyncDispose, so that a bad value fails at startup and not during
    // shutdown, when it would leave every resource open
    if (config.maxDisposeConcurrency !== undefined) {
      validateMaxConcurrency(config.maxDisposeConcurrency, 'maxDisposeConcurrency')
    }
    validateAsyncDisposeConfig(config.diContainer)
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
    await asyncDispose(this.config.diContainer, {
      enableDebugLogging: this.config.enableDebugLogging,
      loggerFn: this.config.loggerFn,
      onDisposeError: this.config.onDisposeError,
      maxConcurrency: this.config.maxDisposeConcurrency,
    })
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
  onNonBlockingInitError?: DependencyErrorHandler
  // How many `concurrent` inits of one priority may run at the same time. Defaults to no limit.
  maxConcurrency?: number
}

export type AsyncDisposeOptions = {
  enableDebugLogging?: boolean
  loggerFn?: Logger
  // Receives the failure of a dispose, and the remaining disposes still run. Without it, the first
  // failure stops the remaining disposes and asyncDispose rejects with it. A handler that throws or
  // rejects fails the priority.
  onDisposeError?: DependencyErrorHandler
  // How many `concurrent` disposes of one priority may run at the same time. Defaults to no limit.
  maxConcurrency?: number
}

type LifecycleConfig<M> = { method?: M; concurrent?: boolean }

function isLifecycleConfig<M>(value: M | LifecycleConfig<M>): value is LifecycleConfig<M> {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('method' in value || 'nonBlocking' in value || 'concurrent' in value)
  )
}

function isAsyncInitConfig(value: unknown): value is AsyncInitConfig<unknown> {
  return isLifecycleConfig(value)
}

// Only called for registrations whose asyncInit / asyncDispose is set, so value is never undefined
// in practice; the optional ResolverOptions field is what makes it part of the type
function getLifecycleMethod<M>(value: M | LifecycleConfig<M> | undefined): M | undefined {
  if (isLifecycleConfig(value)) {
    // If method is not specified, default to true (use default lifecycle method)
    return value.method ?? (true as M)
  }
  return value
}

function isNonBlocking(asyncInit: unknown): boolean {
  return isAsyncInitConfig(asyncInit) && asyncInit.nonBlocking === true
}

function isConcurrent(value: unknown): boolean {
  return isLifecycleConfig(value) && value.concurrent === true
}

function createDebugLogger(enableDebugLogging: boolean | undefined, loggerFn: Logger): Logger {
  return (message) => {
    if (enableDebugLogging) {
      loggerFn(message)
    }
  }
}

function logNonBlockingInitError(dependencyName: string, error: unknown): void {
  console.error(`asyncInit: ${dependencyName} - failed (non-blocking)`, error)
}

type LifecycleEntry = [string, Resolver<any>]

type PriorityResolver = (description: Resolver<any>) => number

function sortByPriority(
  entries: LifecycleEntry[],
  getPriority: PriorityResolver,
): LifecycleEntry[] {
  return entries.sort(([key1, resolver1], [key2, resolver2]) => {
    const priority1 = getPriority(resolver1)
    const priority2 = getPriority(resolver2)

    if (priority1 !== priority2) {
      return priority1 - priority2
    }

    return key1.localeCompare(key2)
  })
}

function groupByPriority(
  sortedEntries: LifecycleEntry[],
  getPriority: PriorityResolver,
): LifecycleEntry[][] {
  const groups: LifecycleEntry[][] = []
  let currentPriority: number | undefined
  for (const entry of sortedEntries) {
    const priority = getPriority(entry[1])
    if (groups.length === 0 || priority !== currentPriority) {
      groups.push([])
      currentPriority = priority
    }
    groups[groups.length - 1].push(entry)
  }
  return groups
}

function validateMaxConcurrency(maxConcurrency: number, optionName: string): void {
  if (
    !(
      (Number.isSafeInteger(maxConcurrency) && maxConcurrency >= 1) ||
      maxConcurrency === Number.POSITIVE_INFINITY
    )
  ) {
    throw new TypeError(
      `Expected ${optionName} to be an integer from 1 and up or Infinity, got ${maxConcurrency}`,
    )
  }
}

function validateAsyncInitConfig(entries: LifecycleEntry[], maxConcurrency: number): void {
  validateMaxConcurrency(maxConcurrency, 'maxConcurrency')

  for (const [key, description] of entries) {
    if (isNonBlocking(description.asyncInit) && isConcurrent(description.asyncInit)) {
      throw new Error(
        `Invalid asyncInit config for ${key}: "nonBlocking" and "concurrent" cannot both be set`,
      )
    }
  }
}

// Dispose has no equivalent of nonBlocking, so an init-style config copied over would be ignored
// silently and the dispose would block shutdown after all
function validateAsyncDisposeConfig(diContainer: AwilixContainer): void {
  for (const [key, description] of Object.entries(diContainer.registrations)) {
    const { asyncDispose } = description
    if (isLifecycleConfig(asyncDispose) && 'nonBlocking' in asyncDispose) {
      throw new Error(`Invalid asyncDispose config for ${key}: "nonBlocking" is not supported`)
    }
  }
}

type PriorityGroupContext = {
  isConcurrent: (description: Resolver<any>) => boolean
  // Runs one dependency's step to completion. A rejection is the failure of the priority.
  run: (key: string, description: Resolver<any>, concurrent: boolean) => Promise<void>
  maxConcurrency: number
}

async function runPriorityGroup(
  priorityGroup: LifecycleEntry[],
  { isConcurrent, run, maxConcurrency }: PriorityGroupContext,
): Promise<void> {
  // The first failure of the priority, in the order failures happen. A concurrent step records its
  // rejection as soon as it lands, so it is handled even while a sequential step is still awaited.
  let failure: { error: unknown } | undefined
  const recordFailure = (error: unknown) => {
    failure ??= { error }
  }

  // The mapper never throws, so pMap resolves only once every concurrent step it started has
  // settled. A step still waiting for a slot when a failure is recorded is never started.
  const concurrentRuns = pMap(
    priorityGroup.filter(([, description]) => isConcurrent(description)),
    async ([key, description]) => {
      if (failure) {
        return
      }
      try {
        await run(key, description, true)
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
      if (isConcurrent(description)) {
        continue
      }
      await run(key, description, false)
    }
  } catch (error) {
    recordFailure(error)
  }

  // Concurrent steps that are already running are waited for even after a failure, so that
  // nothing is still running when the caller reacts to the error, e.g. by disposing.
  await concurrentRuns
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

  const getPriority: PriorityResolver = (description) => description.asyncInitPriority ?? 1
  const dependenciesWithAsyncInit = sortByPriority(
    Object.entries(diContainer.registrations).filter((entry) => {
      return entry[1].asyncInit && entry[1].enabled !== false
    }),
    getPriority,
  )

  validateAsyncInitConfig(dependenciesWithAsyncInit, maxConcurrency)

  const logDebug = createDebugLogger(enableDebugLogging, loggerFn)

  const startInit = (key: string, description: Resolver<any>): Promise<void> => {
    logDebug(`asyncInit: ${key} - started`)

    const resolvedValue = diContainer.resolve(key)
    const method = getLifecycleMethod(description.asyncInit)

    // Validate method existence synchronously before starting async init
    validateAsyncInitMethod(resolvedValue, method, key)

    return executeAsyncInitMethod(resolvedValue, method, key, diContainer)
  }

  const run = async (key: string, description: Resolver<any>, concurrent: boolean) => {
    const initPromise = startInit(key, description)

    if (isNonBlocking(description.asyncInit)) {
      initPromise
        .then(() => logDebug(`asyncInit: ${key} - finished (non-blocking)`))
        .catch((error: unknown) => onNonBlockingInitError(key, error))
      return
    }

    await initPromise
    logDebug(`asyncInit: ${key} - finished${concurrent ? ' (concurrent)' : ''}`)
  }

  for (const priorityGroup of groupByPriority(dependenciesWithAsyncInit, getPriority)) {
    await runPriorityGroup(priorityGroup, {
      isConcurrent: (description) => isConcurrent(description.asyncInit),
      run,
      maxConcurrency,
    })
  }
}

function validateAsyncInitMethod(
  resolvedValue: any,
  method: AsyncInitMethod<unknown> | undefined,
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
  method: AsyncInitMethod<unknown> | undefined,
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

async function executeAsyncDisposeMethod(
  resolvedValue: any,
  method: AsyncDisposeMethod<unknown> | undefined,
): Promise<void> {
  // use default asyncDispose method
  if (method === true) {
    await resolvedValue.asyncDispose()
  } else if (typeof method === 'function') {
    // use function asyncDispose
    await method(resolvedValue)
  } else if (typeof method === 'string') {
    // use custom method name
    await resolvedValue[method]()
  }
}

export async function asyncDispose(
  diContainer: AwilixContainer<any>,
  options: AsyncDisposeOptions = {},
): Promise<void> {
  const {
    enableDebugLogging,
    loggerFn = console.log,
    onDisposeError,
    maxConcurrency = Number.POSITIVE_INFINITY,
  } = options

  validateMaxConcurrency(maxConcurrency, 'maxConcurrency')

  const getPriority: PriorityResolver = (description) => description.asyncDisposePriority ?? 1
  const dependenciesWithAsyncDispose = sortByPriority(
    Object.entries(diContainer.registrations).filter(([_key, description]) => {
      return description.asyncDispose && description.enabled !== false
    }),
    getPriority,
  )

  const logDebug = createDebugLogger(enableDebugLogging, loggerFn)

  // Without onDisposeError, a failed dispose fails the priority. With it, the failure goes to the
  // handler and the remaining disposes still run, so that every resource gets released on shutdown.
  // Only an error thrown or rejected by the handler then fails the priority. Logging stays outside
  // the try, so that a throwing loggerFn is never reported as a failed dispose.
  const run = async (key: string, description: Resolver<any>, concurrent: boolean) => {
    logDebug(`asyncDispose: ${key} - started`)

    try {
      const resolvedValue = diContainer.resolve(key)
      const method = getLifecycleMethod(description.asyncDispose)

      await executeAsyncDisposeMethod(resolvedValue, method)
    } catch (error) {
      logDebug(`asyncDispose: ${key} - failed`)
      if (!onDisposeError) {
        throw error
      }
      await onDisposeError(key, error)
      return
    }

    logDebug(`asyncDispose: ${key} - finished${concurrent ? ' (concurrent)' : ''}`)
  }

  for (const priorityGroup of groupByPriority(dependenciesWithAsyncDispose, getPriority)) {
    await runPriorityGroup(priorityGroup, {
      isConcurrent: (description) => isConcurrent(description.asyncDispose),
      run,
      maxConcurrency,
    })
  }
}
