import type { AwilixContainer } from 'awilix'

declare module 'awilix' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ResolverOptions<T> {
    asyncInit?: boolean | string
    asyncInitPriority?: number // lower means it gets initted earlier
    asyncDispose?: boolean | string
    asyncDisposePriority?: number // lower means it gets disposed earlier
    eagerInject?: boolean
    enabled?: boolean
  }
}

export type AwilixManagerConfig = {
  diContainer: AwilixContainer
  asyncInit?: boolean
  asyncDispose?: boolean
  eagerInject?: boolean
}

export class AwilixManager {
  public readonly config: AwilixManagerConfig

  constructor(config: AwilixManagerConfig) {
    this.config = config
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
      await resolvedValue.asyncInit()
    } else {
      // @ts-ignore
      await resolvedValue[entry[1].asyncInit]()
    }
  }
}

export function eagerInject(diContainer: AwilixContainer) {
  const dependenciesWithEagerInject = Object.entries(diContainer.registrations).filter((entry) => {
    return entry[1].eagerInject && entry[1].enabled !== false
  })

  for (const entry of dependenciesWithEagerInject) {
    diContainer.resolve(entry[0])
  }
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
    if (entry[1].asyncDispose === true) {
      await resolvedValue.asyncDispose()
    } else {
      // @ts-ignore
      await resolvedValue[entry[1].asyncDispose]()
    }
  }
}
