import { asClass, createContainer } from 'awilix'
import { describe, expect, it } from 'vitest'

import { AwilixManager, asyncDispose, asyncInit, getWithTags } from '../lib/awilixManager'

class AsyncInitCounterClass {
  public counter = 0

  asyncInit(dependencies: any) {
    return Promise.resolve().then(() => {
      this.counter++
    })
  }

  asyncDispose() {
    this.counter--
  }
}

class AsyncInitClass {
  isInitted = false
  isUpdated = false

  asyncInit(dependencies: any) {
    if (dependencies.dependency2) {
      dependencies.dependency2.isUpdated += 1
    }

    return Promise.resolve().then(() => {
      this.isInitted = true
    })
  }
}

class AsyncDisposeClass {
  isDisposed = false

  asyncDispose() {
    return Promise.resolve().then(() => {
      this.isDisposed = true
    })
  }
}

let isInittedGlobal = false
let isInittedCustom = false
let isDisposedGlobal = false

class AsyncInitSetClass {
  asyncInit() {
    return Promise.resolve().then(() => {
      isInittedGlobal = true
    })
  }
}
class AsyncInitGetClass {
  asyncInit() {
    return Promise.resolve().then(() => {
      if (!isInittedGlobal) {
        throw new Error('Dependency not initted')
      }
    })
  }
}

class AsyncDisposeSetClass {
  asyncDispose() {
    return Promise.resolve().then(() => {
      isDisposedGlobal = true
    })
  }
}
class AsyncDisposeGetClass {
  asyncDispose() {
    return Promise.resolve().then(() => {
      if (!isDisposedGlobal) {
        throw new Error('Dependency not disposed')
      }
    })
  }
}

class InitSetClass {
  constructor() {
    isInittedGlobal = true
  }

  init() {
    isInittedCustom = true
  }
}

describe('awilixManager', () => {
  describe('constructor', () => {
    it('throws an error if strictBooleanEnforced is set and undefined is passed', () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          enabled: undefined,
        }),
      )
      expect(
        () =>
          new AwilixManager({
            diContainer,
            strictBooleanEnforced: true,
          }),
      ).toThrow(
        /Invalid config for dependency1. "enabled" field can only be set to true or false, or omitted/,
      )
    })
    it('does not throw an error if strictBooleanEnforced is not set and undefined is passed', () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          enabled: undefined,
        }),
      )
      new AwilixManager({
        diContainer,
      })
    })
    it('does not throw an error if strictBooleanEnforced is set and no undefined is passed', () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          enabled: true,
        }),
      )
      new AwilixManager({
        diContainer,
        strictBooleanEnforced: true,
      })
    })
  })

  describe('asyncInit', () => {
    it('execute asyncInit on registered dependencies', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
        }),
      )
      diContainer.register(
        'dependency2',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
        }),
      )
      diContainer.register(
        'dependency3',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: 'asyncInit',
        }),
      )

      await asyncInit(diContainer)

      const { dependency1, dependency2, dependency3 } = diContainer.cradle

      expect(dependency1.isInitted).toBe(true)
      expect(dependency2.isInitted).toBe(false)
      expect(dependency3.isInitted).toBe(true)
    })

    it('execute asyncInit on registered dependencies and use dependencies from cradle', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
        }),
      )
      diContainer.register(
        'dependency2',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
        }),
      )
      diContainer.register(
        'dependency3',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: 'asyncInit',
        }),
      )

      await asyncInit(diContainer)

      const { dependency1, dependency2, dependency3 } = diContainer.cradle

      expect(dependency1.isInitted).toBe(true)
      expect(dependency2.isInitted).toBe(false)
      expect(dependency3.isInitted).toBe(true)

      expect(dependency1.isUpdated).toBe(false)
      expect(dependency2.isUpdated).toBe(2)
      expect(dependency3.isUpdated).toBe(false)
    })

    it('execute getWithTags on registered dependencies with valid tags', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          tags: ['engine', 'google'],
        }),
      )
      diContainer.register(
        'dependency2',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          tags: ['engine', 'google'],
        }),
      )

      await asyncInit(diContainer)

      const { dependency1, dependency2 } = diContainer.cradle
      const expectItemFound = getWithTags(diContainer, ['engine'])
      expect(expectItemFound).toStrictEqual({
        dependency1: dependency1,
        dependency2: dependency2,
      })

      const expectedItemNotFound = getWithTags(diContainer, ['engine', 'engine2'])
      expect(expectedItemNotFound).toStrictEqual({})
    })

    it('execute awilixManager.getWithTags on registered dependencies with valid tags', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })

      class QueueConsumerHighPriorityClass {}

      class QueueConsumerLowPriorityClass {}

      diContainer.register(
        'dependency1',
        asClass(QueueConsumerHighPriorityClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          tags: ['queue', 'high-priority'],
        }),
      )
      diContainer.register(
        'dependency2',
        asClass(QueueConsumerLowPriorityClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          tags: ['queue', 'low-priority'],
        }),
      )

      const awilixManager = new AwilixManager({
        diContainer,
        asyncInit: true,
        asyncDispose: true,
      })

      const { dependency1, dependency2 } = diContainer.cradle
      const result1 = awilixManager.getWithTags(diContainer, ['queue'])
      expect(result1).toStrictEqual({
        dependency1: dependency1,
        dependency2: dependency2,
      })

      const result2 = awilixManager.getWithTags(diContainer, ['queue', 'low-priority'])
      expect(result2).toStrictEqual({
        dependency2: dependency2,
      })
    })

    it('does bit execute asyncInit on registered dependencies if disabled', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          enabled: false,
        }),
      )
      diContainer.register(
        'dependency2',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          eagerInject: true,
        }),
      )
      diContainer.register(
        'dependency3',
        asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: 'asyncInit',
          enabled: false,
        }),
      )

      await asyncInit(diContainer)

      const { dependency1, dependency2, dependency3 } = diContainer.cradle

      expect(dependency1.isInitted).toBe(false)
      expect(dependency2.isInitted).toBe(true)
      expect(dependency3.isInitted).toBe(false)
    })

    it('execute asyncInit on registered dependencies in defined order', async () => {
      isInittedGlobal = false
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncInitGetClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          asyncInitPriority: 2,
        }),
      )
      diContainer.register(
        'dependency2',
        asClass(AsyncInitSetClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          asyncInitPriority: 1,
        }),
      )

      const manager = new AwilixManager({
        diContainer,
        asyncInit: true,
      })
      await manager.executeInit()

      const { dependency1, dependency2 } = diContainer.cradle

      expect(isInittedGlobal).toBe(true)
    })

    it('execute asyncInit on registered dependencies with a deterministic order tiebreaking', async () => {
      isInittedGlobal = false
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency2',
        asClass(AsyncInitGetClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          asyncInitPriority: 1,
        }),
      )
      diContainer.register(
        'dependency1',
        asClass(AsyncInitSetClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          asyncInitPriority: 1,
        }),
      )

      const manager = new AwilixManager({
        diContainer,
        asyncInit: true,
      })
      await manager.executeInit()

      const { dependency1, dependency2 } = diContainer.cradle

      expect(isInittedGlobal).toBe(true)
    })

    it('skips asyncInit when executed multiple times in a row', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'counter',
        asClass(AsyncInitCounterClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
        }),
      )

      const manager = new AwilixManager({
        diContainer,
        asyncInit: true,
      })
      await manager.executeInit()
      await manager.executeInit()

      const { counter } = diContainer.cradle

      expect(counter.counter).toBe(1)
    })

    it('executes asyncInit when executed multiple times in a row, if check is disabled', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'counter',
        asClass(AsyncInitCounterClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
        }),
      )

      const manager = new AwilixManager({
        diContainer,
        asyncInit: true,
        preventRepeatedInits: false,
      })
      await manager.executeInit()
      await manager.executeInit()

      const { counter } = diContainer.cradle

      expect(counter.counter).toBe(2)
    })
  })

  describe('asyncDispose', () => {
    it('execute asyncDispose on registered dependencies', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
        }),
      )
      diContainer.register(
        'dependency2',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
        }),
      )
      diContainer.register(
        'dependency3',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: 'asyncDispose',
        }),
      )

      const manager = new AwilixManager({
        diContainer,
      })
      await manager.executeDispose()

      const { dependency1, dependency2, dependency3 } = diContainer.cradle

      expect(dependency1.isDisposed).toBe(true)
      expect(dependency2.isDisposed).toBe(false)
      expect(dependency3.isDisposed).toBe(true)
    })

    it('execute asyncDispose defined as function on registered dependencies', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: async (instance) => {
            instance.isDisposed = true
          },
        }),
      )
      diContainer.register(
        'dependency2',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
        }),
      )
      diContainer.register(
        'dependency3',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: 'asyncDispose',
        }),
      )

      const manager = new AwilixManager({
        diContainer,
      })
      await manager.executeDispose()

      const { dependency1, dependency2, dependency3 } = diContainer.cradle

      expect(dependency1.isDisposed).toBe(true)
      expect(dependency2.isDisposed).toBe(false)
      expect(dependency3.isDisposed).toBe(true)
    })

    it('does not execute asyncDispose on registered dependencies if disabled', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
          enabled: false,
        }),
      )
      diContainer.register(
        'dependency2',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
        }),
      )
      diContainer.register(
        'dependency3',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: 'asyncDispose',
          enabled: false,
        }),
      )

      const manager = new AwilixManager({
        diContainer,
      })
      await manager.executeDispose()

      const { dependency1, dependency2, dependency3 } = diContainer.cradle

      expect(dependency1.isDisposed).toBe(false)
      expect(dependency2.isDisposed).toBe(true)
      expect(dependency3.isDisposed).toBe(false)
    })

    it('does not execute asyncDispose on registered dependencies if undefined', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
          enabled: false,
        }),
      )
      diContainer.register(
        'dependency2',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
        }),
      )
      diContainer.register(
        'dependency3',
        asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: 'asyncDispose',
          enabled: false,
        }),
      )

      const manager = new AwilixManager({
        diContainer,
      })
      await manager.executeDispose()

      const { dependency1, dependency2, dependency3 } = diContainer.cradle

      expect(dependency1.isDisposed).toBe(false)
      expect(dependency2.isDisposed).toBe(true)
      expect(dependency3.isDisposed).toBe(false)
    })

    it('execute asyncDispose on registered dependencies in defined order', async () => {
      isInittedGlobal = false
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(AsyncDisposeGetClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
          asyncDisposePriority: 2,
        }),
      )
      diContainer.register(
        'dependency2',
        asClass(AsyncDisposeSetClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
          asyncDisposePriority: 1,
        }),
      )

      await asyncDispose(diContainer)

      const { dependency1, dependency2 } = diContainer.cradle

      expect(isDisposedGlobal).toBe(true)
    })

    it('execute asyncDispose on registered dependencies with deterministic tiebreaking', async () => {
      isInittedGlobal = false
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency2',
        asClass(AsyncDisposeGetClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
          asyncDisposePriority: 1,
        }),
      )
      diContainer.register(
        'dependency1',
        asClass(AsyncDisposeSetClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
          asyncDisposePriority: 1,
        }),
      )

      await asyncDispose(diContainer)

      const { dependency1, dependency2 } = diContainer.cradle

      expect(isDisposedGlobal).toBe(true)
    })

    it('executes asyncDispose when executed multiple times in a row, if check is disabled', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'counter',
        asClass(AsyncInitCounterClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          asyncDispose: true,
        }),
      )

      const manager = new AwilixManager({
        diContainer,
        asyncInit: true,
        preventRepeatedInits: false,
      })
      await manager.executeInit()
      await manager.executeDispose()
      await manager.executeDispose()

      const { counter } = diContainer.cradle

      expect(counter.counter).toBe(-1)
    })

    it('prevents executing asyncDispose when executed multiple times in a row, if check is enabled', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'counter',
        asClass(AsyncInitCounterClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          asyncDispose: true,
        }),
      )

      const manager = new AwilixManager({
        diContainer,
        asyncInit: true,
        preventRepeatedInits: false,
        preventDisposeWithoutInit: true,
      })
      await manager.executeInit()
      await manager.executeDispose()
      await manager.executeDispose()

      const { counter } = diContainer.cradle

      expect(counter.counter).toBe(0)
    })

    it('prevents executing asyncDispose when executed without init, if check is enabled', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'counter',
        asClass(AsyncInitCounterClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          asyncDispose: true,
        }),
      )

      const manager = new AwilixManager({
        diContainer,
        asyncInit: true,
        preventRepeatedInits: false,
        preventDisposeWithoutInit: true,
      })
      await manager.executeDispose()

      const { counter } = diContainer.cradle

      expect(counter.counter).toBe(0)
    })
  })

  describe('eagerInject', () => {
    it('injects dependencies eagerly', () => {
      isInittedGlobal = false
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(InitSetClass, {
          lifetime: 'SINGLETON',
          eagerInject: true,
        }),
      )

      const manager = new AwilixManager({
        diContainer,
        eagerInject: true,
      })
      manager.executeInit()

      expect(isInittedGlobal).toBe(true)
    })

    it('injects dependencies eagerly and calls given init method', () => {
      isInittedGlobal = false
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(InitSetClass, {
          lifetime: 'SINGLETON',
          eagerInject: 'init',
        }),
      )

      const manager = new AwilixManager({
        diContainer,
        eagerInject: true,
      })
      manager.executeInit()

      expect(isInittedGlobal).toBe(true)
      expect(isInittedCustom).toBe(true)
    })

    it('does not inject dependencies eagerly if disabled', () => {
      isInittedGlobal = false
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register(
        'dependency1',
        asClass(InitSetClass, {
          lifetime: 'SINGLETON',
          eagerInject: true,
          enabled: false,
        }),
      )

      const manager = new AwilixManager({
        diContainer,
        eagerInject: true,
      })
      manager.executeInit()

      expect(isInittedGlobal).toBe(false)
    })
  })
})
