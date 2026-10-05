import { asClass, asFunction, createContainer, type NameAndRegistrationPair } from 'awilix'
import type { Resolver } from 'awilix/lib/resolvers'
import { describe, expect, it, vi } from 'vitest'
import {
  AwilixManager,
  asMockClass,
  asMockFunction,
  asMockValue,
  asyncDispose,
  asyncInit,
  getByPredicate,
  getWithTags,
} from '../lib/awilixManager'

class SuperClass1 {}
class SuperClass2 {}

class AsyncInitClass extends SuperClass1 {
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

class AsyncDisposeClass extends SuperClass2 {
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

// asyncInit stays pending until the test settles it, so it can observe what runs in between
class DeferredInit {
  isStarted = false
  resolve: () => void = () => undefined
  reject: (error: unknown) => void = () => undefined

  asyncInit() {
    this.isStarted = true
    return new Promise<void>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

// asyncDispose stays pending until the test settles it, so it can observe what runs in between
class DeferredDispose {
  isStarted = false
  resolve: () => void = () => undefined
  reject: (error: unknown) => void = () => undefined

  asyncDispose() {
    this.isStarted = true
    return new Promise<void>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve))

describe('asMockClass', () => {
  it('Supports passing a mock instance that does not fully implement the real class', () => {
    type DiContainerType = {
      asyncInitClass: AsyncInitClass
      asyncInitClass2: AsyncInitClass
    }
    const diConfiguration: NameAndRegistrationPair<DiContainerType> = {
      asyncInitClass: asClass(AsyncInitClass),
      asyncInitClass2: asMockClass(AsyncDisposeClass),
    }

    const diContainer = createContainer<DiContainerType>({
      injectionMode: 'PROXY',
    })

    for (const [dependencyKey, dependencyValue] of Object.entries(diConfiguration)) {
      diContainer.register(dependencyKey, dependencyValue as Resolver<unknown>)
    }

    const { asyncInitClass, asyncInitClass2 } = diContainer.cradle
    expect(asyncInitClass).toBeInstanceOf(AsyncInitClass)
    expect(asyncInitClass2).toBeInstanceOf(AsyncDisposeClass)
  })
})

describe('asMockFunction', () => {
  it('Supports passing a mock instance that does not fully implement the real class', () => {
    type DiContainerType = {
      asyncInitClass: AsyncInitClass
      asyncInitClass2: AsyncInitClass
    }
    const diConfiguration: NameAndRegistrationPair<DiContainerType> = {
      asyncInitClass: asClass(AsyncInitClass),
      asyncInitClass2: asMockFunction(() => {
        return new AsyncDisposeClass()
      }),
    }

    const diContainer = createContainer<DiContainerType>({
      injectionMode: 'PROXY',
    })

    for (const [dependencyKey, dependencyValue] of Object.entries(diConfiguration)) {
      diContainer.register(dependencyKey, dependencyValue as Resolver<unknown>)
    }

    const { asyncInitClass, asyncInitClass2 } = diContainer.cradle
    expect(asyncInitClass).toBeInstanceOf(AsyncInitClass)
    expect(asyncInitClass2).toBeInstanceOf(AsyncDisposeClass)
  })
})

describe('asMockValue', () => {
  it('Supports passing a mock instance that does not fully implement the real class', () => {
    type DiContainerType = {
      asyncInitClass: AsyncInitClass
      asyncInitClass2: AsyncInitClass
    }
    const diConfiguration: NameAndRegistrationPair<DiContainerType> = {
      asyncInitClass: asClass(AsyncInitClass),
      asyncInitClass2: asMockValue(new AsyncDisposeClass()),
    }

    const diContainer = createContainer<DiContainerType>({
      injectionMode: 'PROXY',
    })

    for (const [dependencyKey, dependencyValue] of Object.entries(diConfiguration)) {
      diContainer.register(dependencyKey, dependencyValue as Resolver<unknown>)
    }

    const { asyncInitClass, asyncInitClass2 } = diContainer.cradle
    expect(asyncInitClass).toBeInstanceOf(AsyncInitClass)
    expect(asyncInitClass2).toBeInstanceOf(AsyncDisposeClass)
  })
})

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

  describe('getByPredicate', () => {
    it('retrieves entries by predicate', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
        .register(
          'dependency1',
          asClass(AsyncInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: true,
          }),
        )
        .register(
          'dependency2',
          asClass(AsyncInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: true,
          }),
        )
        .register(
          'dependency3',
          asClass(AsyncDisposeClass, {
            lifetime: 'SINGLETON',
          }),
        )
        .register(
          'dependency4',
          asClass(AsyncDisposeClass, {
            lifetime: 'SINGLETON',
            enabled: false,
          }),
        )

      const awilixManager = new AwilixManager({
        diContainer,
        asyncInit: true,
        asyncDispose: true,
      })
      await awilixManager.executeInit()

      const { dependency1, dependency2, dependency3 } = diContainer.cradle
      const superClass1Entries = awilixManager.getByPredicate(
        (entry) => entry instanceof SuperClass1,
      )
      expect(superClass1Entries).toStrictEqual({
        dependency1: dependency1,
        dependency2: dependency2,
      })

      const superClass2Entries = getByPredicate(
        diContainer,
        (entry) => entry instanceof SuperClass2,
      )
      expect(superClass2Entries).toStrictEqual({
        dependency3: dependency3,
      })
    })
  })

  describe('asyncInit', () => {
    describe('sequential', () => {
      it('execute asyncInit on registered dependencies', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
          .register(
            'dependency1',
            asClass(AsyncInitClass, {
              lifetime: 'SINGLETON',
              asyncInit: true,
            }),
          )
          .register(
            'dependency2',
            asClass(AsyncInitClass, {
              lifetime: 'SINGLETON',
            }),
          )
          .register(
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

      it('supports function as asyncInit', async () => {
        type DiContainerType = {
          dependency1: AsyncInitClass
          dependency2: AsyncInitClass
          dependency3: AsyncInitClass
        }

        const diContainer = createContainer<DiContainerType>({
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
            asyncInit: (instance, _diContainer) => {
              return instance.asyncInit(instance)
            },
          }),
        )

        await asyncInit(diContainer)

        const { dependency1, dependency2, dependency3 } = diContainer.cradle

        expect(dependency1.isInitted).toBe(true)
        expect(dependency2.isInitted).toBe(false)
        expect(dependency3.isInitted).toBe(true)
      })

      it('throws a clear error when asyncInit method does not exist', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        }).register(
          'dependency1',
          asClass(AsyncInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: 'dummy',
          }),
        )

        await expect(() => asyncInit(diContainer)).rejects.toThrowError(
          'Method dummy for asyncInit does not exist on dependency dependency1',
        )
      })

      it('throws a clear error when default asyncInit method does not exist', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        }).register(
          'dependency1',
          asClass(AsyncDisposeClass, {
            lifetime: 'SINGLETON',
            asyncInit: true,
          }),
        )

        await expect(() => asyncInit(diContainer)).rejects.toThrowError(
          'Method asyncInit does not exist on dependency dependency1',
        )
      })

      it('execute asyncInit on registered dependencies and use dependencies from cradle', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
          .register(
            'dependency1',
            asClass(AsyncInitClass, {
              lifetime: 'SINGLETON',
              asyncInit: true,
            }),
          )
          .register(
            'dependency2',
            asClass(AsyncInitClass, {
              lifetime: 'SINGLETON',
            }),
          )
          .register(
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
          .register(
            'dependency1',
            asClass(AsyncInitClass, {
              lifetime: 'SINGLETON',
              asyncInit: true,
              tags: ['engine', 'google'],
            }),
          )
          .register(
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

      it('execute awilixManager.getWithTags on registered dependencies with valid tags', () => {
        class QueueConsumerHighPriorityClass {}
        class QueueConsumerLowPriorityClass {}

        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
          .register(
            'dependency1',
            asClass(QueueConsumerHighPriorityClass, {
              lifetime: 'SINGLETON',
              asyncInit: true,
              tags: ['queue', 'high-priority'],
            }),
          )
          .register(
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
        const result1 = awilixManager.getWithTags(['queue'])
        expect(result1).toStrictEqual({
          dependency1: dependency1,
          dependency2: dependency2,
        })

        const result2 = awilixManager.getWithTags(['queue', 'low-priority'])
        expect(result2).toStrictEqual({
          dependency2: dependency2,
        })
      })

      it('does not execute asyncInit on registered dependencies if disabled', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
          .register(
            'dependency1',
            asClass(AsyncInitClass, {
              lifetime: 'SINGLETON',
              asyncInit: true,
              enabled: false,
            }),
          )
          .register(
            'dependency2',
            asClass(AsyncInitClass, {
              lifetime: 'SINGLETON',
              asyncInit: true,
              eagerInject: true,
            }),
          )
          .register(
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
          .register(
            'dependency1',
            asClass(AsyncInitGetClass, {
              lifetime: 'SINGLETON',
              asyncInit: true,
              asyncInitPriority: 2,
            }),
          )
          .register(
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

        const { dependency1: _1, dependency2: _2 } = diContainer.cradle

        expect(isInittedGlobal).toBe(true)
      })

      it('execute asyncInit on registered dependencies with a deterministic order tiebreaking', async () => {
        isInittedGlobal = false
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
          .register(
            'dependency2',
            asClass(AsyncInitGetClass, {
              lifetime: 'SINGLETON',
              asyncInit: true,
              asyncInitPriority: 1,
            }),
          )
          .register(
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

        const { dependency1: _1, dependency2: _2 } = diContainer.cradle

        expect(isInittedGlobal).toBe(true)
      })

      it('logs dependency names when debug logging is enabled', async () => {
        const loggedMessages: string[] = []
        const customLogger = (message: string) => {
          loggedMessages.push(message)
        }

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
            asyncInit: true,
          }),
        )

        await asyncInit(diContainer, {
          enableDebugLogging: true,
          loggerFn: customLogger,
        })

        expect(loggedMessages).toEqual([
          'asyncInit: dependency1 - started',
          'asyncInit: dependency1 - finished',
          'asyncInit: dependency2 - started',
          'asyncInit: dependency2 - finished',
        ])
      })

      it('does not log when debug logging is disabled', async () => {
        const loggedMessages: string[] = []
        const customLogger = (message: string) => {
          loggedMessages.push(message)
        }

        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        diContainer.register(
          'dependency1',
          asClass(AsyncInitSetClass, {
            lifetime: 'SINGLETON',
            asyncInit: true,
          }),
        )

        await asyncInit(diContainer, {
          enableDebugLogging: false,
          loggerFn: customLogger,
        })

        expect(loggedMessages).toEqual([])
      })

      it('logs dependency names via AwilixManager when debug logging is enabled', async () => {
        const loggedMessages: string[] = []
        const customLogger = (message: string) => {
          loggedMessages.push(message)
        }

        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        diContainer.register(
          'dependency1',
          asClass(AsyncInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: true,
            asyncInitPriority: 2,
          }),
        )
        diContainer.register(
          'dependency2',
          asClass(AsyncInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: true,
            asyncInitPriority: 1,
          }),
        )

        const manager = new AwilixManager({
          diContainer,
          asyncInit: true,
          enableDebugLogging: true,
          loggerFn: customLogger,
        })
        await manager.executeInit()

        expect(loggedMessages).toEqual([
          'asyncInit: dependency2 - started',
          'asyncInit: dependency2 - finished',
          'asyncInit: dependency1 - started',
          'asyncInit: dependency1 - finished',
        ])
      })

      it('supports object syntax with method only (blocking by default)', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })

        let initFinished = false

        class CustomInitClass {
          async customInit() {
            await new Promise((resolve) => setTimeout(resolve, 10))
            initFinished = true
          }
        }

        diContainer.register(
          'dependency1',
          asClass(CustomInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: { method: 'customInit' },
          }),
        )

        await asyncInit(diContainer)

        // Init should have finished because it's blocking
        expect(initFinished).toBe(true)
      })

      it('supports object syntax with method explicitly disabled (method: false)', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })

        let initCalled = false

        class CustomInitClass {
          asyncInit() {
            initCalled = true
            return Promise.resolve()
          }
        }

        diContainer.register(
          'dependency1',
          asClass(CustomInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: { method: false },
          }),
        )

        await asyncInit(diContainer)

        // No init method should be executed when method is explicitly false
        expect(initCalled).toBe(false)
      })

      it('supports object syntax with nonBlocking: false (blocking)', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })

        let initFinished = false

        class SlowAsyncInitClass {
          async asyncInit() {
            await new Promise((resolve) => setTimeout(resolve, 10))
            initFinished = true
          }
        }

        diContainer.register(
          'dependency1',
          asClass(SlowAsyncInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: { nonBlocking: false },
          }),
        )

        await asyncInit(diContainer)

        // Init should have finished because it's blocking
        expect(initFinished).toBe(true)
      })
    })

    describe('non-blocking', () => {
      it('supports object syntax with nonBlocking option using default method', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })

        let initStarted = false
        let initFinished = false

        class SlowAsyncInitClass {
          async asyncInit() {
            initStarted = true
            await new Promise((resolve) => setTimeout(resolve, 50))
            initFinished = true
          }
        }

        diContainer.register(
          'dependency1',
          asClass(SlowAsyncInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: { nonBlocking: true },
          }),
        )

        await asyncInit(diContainer)

        // Init should have started but not finished yet
        expect(initStarted).toBe(true)
        expect(initFinished).toBe(false)

        // Wait for the async init to complete
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(initFinished).toBe(true)
      })

      it('supports object syntax with nonBlocking option using custom method name', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })

        let initStarted = false
        let initFinished = false

        class SlowCustomInitClass {
          async customInit() {
            initStarted = true
            await new Promise((resolve) => setTimeout(resolve, 50))
            initFinished = true
          }
        }

        diContainer.register(
          'dependency1',
          asClass(SlowCustomInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: { method: 'customInit', nonBlocking: true },
          }),
        )

        await asyncInit(diContainer)

        // Init should have started but not finished yet
        expect(initStarted).toBe(true)
        expect(initFinished).toBe(false)

        // Wait for the async init to complete
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(initFinished).toBe(true)
      })

      it('supports object syntax with nonBlocking option using custom function', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })

        let initStarted = false
        let initFinished = false

        class SlowInitClass {
          async doInit() {
            initStarted = true
            await new Promise((resolve) => setTimeout(resolve, 50))
            initFinished = true
          }
        }

        diContainer.register(
          'dependency1',
          asClass(SlowInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: {
              method: (instance) => instance.doInit(),
              nonBlocking: true,
            },
          }),
        )

        await asyncInit(diContainer)

        // Init should have started but not finished yet
        expect(initStarted).toBe(true)
        expect(initFinished).toBe(false)

        // Wait for the async init to complete
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(initFinished).toBe(true)
      })

      it('logs non-blocking dependencies with correct message', async () => {
        const loggedMessages: string[] = []
        const customLogger = (message: string) => {
          loggedMessages.push(message)
        }

        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })

        class SlowAsyncInitClass {
          async asyncInit() {
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
        }

        diContainer.register(
          'dependency1',
          asClass(SlowAsyncInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: { nonBlocking: true },
          }),
        )

        await asyncInit(diContainer, {
          enableDebugLogging: true,
          loggerFn: customLogger,
        })

        // Only started message should be logged immediately
        expect(loggedMessages).toEqual(['asyncInit: dependency1 - started'])

        // Wait for the async init to complete
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(loggedMessages).toEqual([
          'asyncInit: dependency1 - started',
          'asyncInit: dependency1 - finished (non-blocking)',
        ])
      })

      it('throws error when method does not exist with object syntax', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })

        diContainer.register(
          'dependency1',
          asClass(AsyncInitClass, {
            lifetime: 'SINGLETON',
            asyncInit: { method: 'nonExistentMethod', nonBlocking: true },
          }),
        )

        await expect(() => asyncInit(diContainer)).rejects.toThrowError(
          'Method nonExistentMethod for asyncInit does not exist on dependency dependency1',
        )
      })

      it('throws error when default asyncInit method does not exist with object syntax', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })

        diContainer.register(
          'dependency1',
          asClass(AsyncDisposeClass, {
            lifetime: 'SINGLETON',
            asyncInit: { nonBlocking: true },
          }),
        )

        await expect(() => asyncInit(diContainer)).rejects.toThrowError(
          'Method asyncInit does not exist on dependency dependency1',
        )
      })

      it('passes a non-blocking init failure to onNonBlockingInitError', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const initError = new Error('init failed')
        diContainer.register(
          'dependency1',
          asFunction(() => ({ asyncInit: () => Promise.reject(initError) }), {
            lifetime: 'SINGLETON',
            asyncInit: { nonBlocking: true },
          }),
        )
        const onNonBlockingInitError = vi.fn()

        const manager = new AwilixManager({
          diContainer,
          asyncInit: true,
          onNonBlockingInitError,
        })
        await manager.executeInit()
        await flushPromises()

        expect(onNonBlockingInitError).toHaveBeenCalledWith('dependency1', initError)
      })

      it('logs a non-blocking init failure with console.error by default', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const initError = new Error('init failed')
        diContainer.register(
          'dependency1',
          asFunction(() => ({ asyncInit: () => Promise.reject(initError) }), {
            lifetime: 'SINGLETON',
            asyncInit: { nonBlocking: true },
          }),
        )

        try {
          await asyncInit(diContainer)
          await flushPromises()

          expect(consoleErrorSpy).toHaveBeenCalledWith(
            'asyncInit: dependency1 - failed (non-blocking)',
            initError,
          )
        } finally {
          consoleErrorSpy.mockRestore()
        }
      })

      it('passes a loggerFn error after a non-blocking init to onNonBlockingInitError', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        diContainer.register(
          'dependency1',
          asFunction(() => ({ asyncInit: () => Promise.resolve() }), {
            lifetime: 'SINGLETON',
            asyncInit: { nonBlocking: true },
          }),
        )
        const loggerError = new Error('logger failed')
        const onNonBlockingInitError = vi.fn()

        await asyncInit(diContainer, {
          enableDebugLogging: true,
          loggerFn: (message) => {
            if (message.includes('finished')) {
              throw loggerError
            }
          },
          onNonBlockingInitError,
        })
        await flushPromises()

        expect(onNonBlockingInitError).toHaveBeenCalledWith('dependency1', loggerError)
      })
    })

    describe('concurrent', () => {
      it('runs concurrent inits of the same priority at the same time', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const dependency1 = new DeferredInit()
        const dependency2 = new DeferredInit()
        diContainer.register({
          dependency1: asFunction(() => dependency1, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
          dependency2: asFunction(() => dependency2, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
        })

        const initPromise = asyncInit(diContainer)
        await flushPromises()

        expect(dependency1.isStarted).toBe(true)
        expect(dependency2.isStarted).toBe(true)

        dependency1.resolve()
        dependency2.resolve()
        await initPromise
      })

      it('finishes concurrent inits before starting the next priority', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const dependency1 = new DeferredInit()
        const dependency2 = new DeferredInit()
        diContainer.register({
          dependency1: asFunction(() => dependency1, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
            asyncInitPriority: 1,
          }),
          dependency2: asFunction(() => dependency2, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
            asyncInitPriority: 2,
          }),
        })

        const initPromise = asyncInit(diContainer)
        await flushPromises()

        expect(dependency1.isStarted).toBe(true)
        expect(dependency2.isStarted).toBe(false)

        dependency1.resolve()
        await flushPromises()

        expect(dependency2.isStarted).toBe(true)

        dependency2.resolve()
        await initPromise
      })

      it('rejects with a concurrent init failure only after the other concurrent inits settle', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const initError = new Error('init failed')
        const failingDependency = new DeferredInit()
        const slowDependency = new DeferredInit()
        diContainer.register({
          dependency1: asFunction(() => failingDependency, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
          dependency2: asFunction(() => slowDependency, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
        })

        let isRejected = false
        const initPromise = asyncInit(diContainer).catch((error: unknown) => {
          isRejected = true
          return error
        })
        await flushPromises()
        failingDependency.reject(initError)
        await flushPromises()

        expect(slowDependency.isStarted).toBe(true)
        expect(isRejected).toBe(false)

        slowDependency.resolve()

        expect(await initPromise).toBe(initError)
      })

      it('supports a custom method with the concurrent option', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const dependency1 = {
          isStarted: false,
          start() {
            this.isStarted = true
            return Promise.resolve()
          },
        }
        diContainer.register(
          'dependency1',
          asFunction(() => dependency1, {
            lifetime: 'SINGLETON',
            asyncInit: { method: 'start', concurrent: true },
          }),
        )

        await asyncInit(diContainer)

        expect(dependency1.isStarted).toBe(true)
      })

      it('runs at most maxConcurrency concurrent inits of a priority at a time', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const dependencies = [new DeferredInit(), new DeferredInit(), new DeferredInit()]
        diContainer.register({
          dependency1: asFunction(() => dependencies[0], {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
          dependency2: asFunction(() => dependencies[1], {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
          dependency3: asFunction(() => dependencies[2], {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
        })

        const initPromise = asyncInit(diContainer, { maxConcurrency: 2 })
        await flushPromises()

        expect(dependencies.map((dependency) => dependency.isStarted)).toEqual([true, true, false])

        dependencies[0].resolve()
        await flushPromises()

        expect(dependencies[2].isStarted).toBe(true)

        dependencies[1].resolve()
        dependencies[2].resolve()
        await initPromise
      })

      it('does not start a concurrent init waiting for a slot once an init has failed', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const initError = new Error('init failed')
        const failingDependency = new DeferredInit()
        const queuedDependency = new DeferredInit()
        diContainer.register({
          dependency1: asFunction(() => failingDependency, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
          dependency2: asFunction(() => queuedDependency, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
        })

        const initPromise = asyncInit(diContainer, { maxConcurrency: 1 }).catch(
          (error: unknown) => error,
        )
        await flushPromises()
        failingDependency.reject(initError)

        expect(await initPromise).toBe(initError)
        expect(queuedDependency.isStarted).toBe(false)
      })

      it('passes maxConcurrency from the AwilixManager config', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const dependency1 = new DeferredInit()
        const dependency2 = new DeferredInit()
        diContainer.register({
          dependency1: asFunction(() => dependency1, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
          dependency2: asFunction(() => dependency2, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
        })
        const manager = new AwilixManager({ diContainer, asyncInit: true, maxConcurrency: 1 })

        const initPromise = manager.executeInit()
        await flushPromises()

        expect(dependency2.isStarted).toBe(false)

        dependency1.resolve()
        await flushPromises()
        dependency2.resolve()
        await initPromise
      })

      it.each([0, 1.5, -1, Number.NaN])('rejects maxConcurrency %s', async (maxConcurrency) => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })

        await expect(asyncInit(diContainer, { maxConcurrency })).rejects.toThrow(
          `Expected maxConcurrency to be an integer from 1 and up or Infinity, got ${maxConcurrency}`,
        )
      })

      it('waits for the other concurrent inits when loggerFn throws after a concurrent init', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const fastDependency = new DeferredInit()
        const slowDependency = new DeferredInit()
        diContainer.register({
          dependency1: asFunction(() => fastDependency, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
          dependency2: asFunction(() => slowDependency, {
            lifetime: 'SINGLETON',
            asyncInit: { concurrent: true },
          }),
        })

        let isRejected = false
        const initPromise = asyncInit(diContainer, {
          enableDebugLogging: true,
          loggerFn: (message) => {
            if (message.includes('finished')) {
              throw new Error(message)
            }
          },
        }).catch((error: unknown) => {
          isRejected = true
          return error
        })
        await flushPromises()
        fastDependency.resolve()
        await flushPromises()

        expect(slowDependency.isStarted).toBe(true)
        expect(isRejected).toBe(false)

        slowDependency.resolve()

        expect(await initPromise).toEqual(
          new Error('asyncInit: dependency1 - finished (concurrent)'),
        )
      })
    })

    it('runs sequential inits of the same priority in order while concurrent ones are pending', async () => {
      const loggedMessages: string[] = []
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      const concurrentDependency = new DeferredInit()
      diContainer.register({
        dependency1: asFunction(() => concurrentDependency, {
          lifetime: 'SINGLETON',
          asyncInit: { concurrent: true },
        }),
        dependency2: asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
        }),
        dependency3: asClass(AsyncInitClass, {
          lifetime: 'SINGLETON',
          asyncInit: true,
        }),
      })

      const initPromise = asyncInit(diContainer, {
        enableDebugLogging: true,
        loggerFn: (message) => loggedMessages.push(message),
      })
      await flushPromises()

      expect(loggedMessages).toEqual([
        'asyncInit: dependency2 - started',
        'asyncInit: dependency1 - started',
        'asyncInit: dependency2 - finished',
        'asyncInit: dependency3 - started',
        'asyncInit: dependency3 - finished',
      ])

      concurrentDependency.resolve()
      await initPromise

      expect(loggedMessages.at(-1)).toBe('asyncInit: dependency1 - finished (concurrent)')
    })

    it('waits for running concurrent inits when a sequential init of the same priority fails', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      const initError = new Error('init failed')
      const concurrentDependency = new DeferredInit()
      diContainer.register({
        dependency1: asFunction(() => concurrentDependency, {
          lifetime: 'SINGLETON',
          asyncInit: { concurrent: true },
        }),
        dependency2: asFunction(() => ({ asyncInit: () => Promise.reject(initError) }), {
          lifetime: 'SINGLETON',
          asyncInit: true,
        }),
      })

      let isRejected = false
      const initPromise = asyncInit(diContainer).catch((error: unknown) => {
        isRejected = true
        return error
      })
      await flushPromises()

      expect(isRejected).toBe(false)

      concurrentDependency.resolve()

      expect(await initPromise).toBe(initError)
    })

    it('rejects with the earliest failure and starts no further inits once one has failed', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      const initError = new Error('init failed')
      const sequentialDependency = new DeferredInit()
      const laterDependency = new DeferredInit()
      diContainer.register({
        dependency1: asFunction(() => ({ asyncInit: () => Promise.reject(initError) }), {
          lifetime: 'SINGLETON',
          asyncInit: { concurrent: true },
        }),
        dependency2: asFunction(() => sequentialDependency, {
          lifetime: 'SINGLETON',
          asyncInit: true,
        }),
        dependency3: asFunction(
          () => ({ asyncInit: () => Promise.reject(new Error('later failure')) }),
          {
            lifetime: 'SINGLETON',
            asyncInit: true,
          },
        ),
        dependency4: asFunction(() => laterDependency, {
          lifetime: 'SINGLETON',
          asyncInit: true,
        }),
      })

      const initPromise = asyncInit(diContainer).catch((error: unknown) => error)
      await flushPromises()
      sequentialDependency.resolve()

      expect(await initPromise).toBe(initError)
      expect(laterDependency.isStarted).toBe(false)
    })

    it('rejects nonBlocking and concurrent set together before starting any init', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      const earlierDependency = new DeferredInit()
      diContainer.register({
        dependency1: asFunction(() => earlierDependency, {
          lifetime: 'SINGLETON',
          asyncInit: true,
          asyncInitPriority: 0,
        }),
        dependency2: asFunction(() => new DeferredInit(), {
          lifetime: 'SINGLETON',
          // @ts-expect-error the two options cannot be combined
          asyncInit: { nonBlocking: true, concurrent: true },
        }),
      })

      await expect(asyncInit(diContainer)).rejects.toThrow(
        'Invalid asyncInit config for dependency2: "nonBlocking" and "concurrent" cannot both be set',
      )
      expect(earlierDependency.isStarted).toBe(false)
    })
  })

  describe('asyncDispose', () => {
    describe('sequential', () => {
      it('execute asyncDispose on registered dependencies', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
          .register(
            'dependency1',
            asClass(AsyncDisposeClass, {
              lifetime: 'SINGLETON',
              asyncDispose: true,
            }),
          )
          .register(
            'dependency2',
            asClass(AsyncDisposeClass, {
              lifetime: 'SINGLETON',
            }),
          )
          .register(
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
          .register(
            'dependency1',
            asClass(AsyncDisposeClass, {
              lifetime: 'SINGLETON',
              asyncDispose: (instance) => {
                instance.isDisposed = true
                return Promise.resolve()
              },
            }),
          )
          .register(
            'dependency2',
            asClass(AsyncDisposeClass, {
              lifetime: 'SINGLETON',
            }),
          )
          .register(
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
          .register(
            'dependency1',
            asClass(AsyncDisposeClass, {
              lifetime: 'SINGLETON',
              asyncDispose: true,
              enabled: false,
            }),
          )
          .register(
            'dependency2',
            asClass(AsyncDisposeClass, {
              lifetime: 'SINGLETON',
              asyncDispose: true,
            }),
          )
          .register(
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
          .register(
            'dependency1',
            asClass(AsyncDisposeClass, {
              lifetime: 'SINGLETON',
              asyncDispose: true,
              enabled: false,
            }),
          )
          .register(
            'dependency2',
            asClass(AsyncDisposeClass, {
              lifetime: 'SINGLETON',
              asyncDispose: true,
            }),
          )
          .register(
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
        isDisposedGlobal = false
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
          .register(
            'dependency1',
            asClass(AsyncDisposeGetClass, {
              lifetime: 'SINGLETON',
              asyncDispose: true,
              asyncDisposePriority: 2,
            }),
          )
          .register(
            'dependency2',
            asClass(AsyncDisposeSetClass, {
              lifetime: 'SINGLETON',
              asyncDispose: true,
              asyncDisposePriority: 1,
            }),
          )

        await asyncDispose(diContainer)

        const { dependency1: _1, dependency2: _2 } = diContainer.cradle

        expect(isDisposedGlobal).toBe(true)
      })

      it('execute asyncDispose on registered dependencies with deterministic tiebreaking', async () => {
        isDisposedGlobal = false
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
          .register(
            'dependency2',
            asClass(AsyncDisposeGetClass, {
              lifetime: 'SINGLETON',
              asyncDispose: true,
              asyncDisposePriority: 1,
            }),
          )
          .register(
            'dependency1',
            asClass(AsyncDisposeSetClass, {
              lifetime: 'SINGLETON',
              asyncDispose: true,
              asyncDisposePriority: 1,
            }),
          )

        await asyncDispose(diContainer)

        const { dependency1: _1, dependency2: _2 } = diContainer.cradle

        expect(isDisposedGlobal).toBe(true)
      })

      it('supports object syntax with method explicitly disabled (method: false)', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        diContainer.register(
          'dependency1',
          asClass(AsyncDisposeClass, {
            lifetime: 'SINGLETON',
            asyncDispose: { method: false },
          }),
        )

        await asyncDispose(diContainer)

        expect(diContainer.resolve<AsyncDisposeClass>('dependency1').isDisposed).toBe(false)
      })

      it('rejects with the first failure and skips the remaining disposes without onDisposeError', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const disposeError = new Error('dispose failed')
        const laterDependency = new DeferredDispose()
        const nextPriorityDependency = new DeferredDispose()
        diContainer.register({
          dependency1: asFunction(() => ({ asyncDispose: () => Promise.reject(disposeError) }), {
            lifetime: 'SINGLETON',
            asyncDispose: true,
          }),
          dependency2: asFunction(() => laterDependency, {
            lifetime: 'SINGLETON',
            asyncDispose: true,
          }),
          dependency3: asFunction(() => nextPriorityDependency, {
            lifetime: 'SINGLETON',
            asyncDispose: true,
            asyncDisposePriority: 2,
          }),
        })

        await expect(asyncDispose(diContainer)).rejects.toBe(disposeError)
        expect(laterDependency.isStarted).toBe(false)
        expect(nextPriorityDependency.isStarted).toBe(false)
      })

      it('passes a missing dispose method to onDisposeError', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        diContainer.register({
          dependency1: asFunction(() => ({}), {
            lifetime: 'SINGLETON',
            asyncDispose: true,
          }),
          dependency2: asFunction(() => ({}), {
            lifetime: 'SINGLETON',
            asyncDispose: 'close',
          }),
        })
        const onDisposeError = vi.fn()

        await asyncDispose(diContainer, { onDisposeError })

        expect(onDisposeError.mock.calls).toEqual([
          ['dependency1', expect.any(TypeError)],
          ['dependency2', expect.any(TypeError)],
        ])
      })

      it('passes onDisposeError from the AwilixManager config', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const disposeError = new Error('dispose failed')
        diContainer.register({
          dependency1: asFunction(() => ({ asyncDispose: () => Promise.reject(disposeError) }), {
            lifetime: 'SINGLETON',
            asyncDispose: true,
          }),
          dependency2: asClass(AsyncDisposeClass, {
            lifetime: 'SINGLETON',
            asyncDispose: true,
          }),
        })
        const onDisposeError = vi.fn()
        const manager = new AwilixManager({ diContainer, onDisposeError })

        await manager.executeDispose()

        expect(onDisposeError).toHaveBeenCalledWith('dependency1', disposeError)
        expect(diContainer.resolve<AsyncDisposeClass>('dependency2').isDisposed).toBe(true)
      })
    })

    describe('concurrent', () => {
      it('runs concurrent disposes of the same priority at the same time', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const dependency1 = new DeferredDispose()
        const dependency2 = new DeferredDispose()
        diContainer.register({
          dependency1: asFunction(() => dependency1, {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
          dependency2: asFunction(() => dependency2, {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
        })

        const disposePromise = asyncDispose(diContainer)
        await flushPromises()

        expect(dependency1.isStarted).toBe(true)
        expect(dependency2.isStarted).toBe(true)

        dependency1.resolve()
        dependency2.resolve()
        await disposePromise
      })

      it('supports custom method and function with the concurrent option', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const dependency1 = {
          isClosed: false,
          close() {
            this.isClosed = true
            return Promise.resolve()
          },
        }
        const dependency2 = { isClosed: false }
        diContainer.register({
          dependency1: asFunction(() => dependency1, {
            lifetime: 'SINGLETON',
            asyncDispose: { method: 'close', concurrent: true },
          }),
          dependency2: asFunction(() => dependency2, {
            lifetime: 'SINGLETON',
            asyncDispose: {
              method: (instance) => {
                instance.isClosed = true
                return Promise.resolve()
              },
              concurrent: true,
            },
          }),
        })

        await asyncDispose(diContainer)

        expect(dependency1.isClosed).toBe(true)
        expect(dependency2.isClosed).toBe(true)
      })

      it('runs at most maxConcurrency concurrent disposes of a priority at a time', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const dependencies = [new DeferredDispose(), new DeferredDispose(), new DeferredDispose()]
        diContainer.register({
          dependency1: asFunction(() => dependencies[0], {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
          dependency2: asFunction(() => dependencies[1], {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
          dependency3: asFunction(() => dependencies[2], {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
        })

        const disposePromise = asyncDispose(diContainer, { maxConcurrency: 2 })
        await flushPromises()

        expect(dependencies.map((dependency) => dependency.isStarted)).toEqual([true, true, false])

        dependencies[0].resolve()
        await flushPromises()

        expect(dependencies[2].isStarted).toBe(true)

        dependencies[1].resolve()
        dependencies[2].resolve()
        await disposePromise
      })

      it('passes maxDisposeConcurrency from the AwilixManager config', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const dependency1 = new DeferredDispose()
        const dependency2 = new DeferredDispose()
        diContainer.register({
          dependency1: asFunction(() => dependency1, {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
          dependency2: asFunction(() => dependency2, {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
        })
        const manager = new AwilixManager({
          diContainer,
          maxConcurrency: 2,
          maxDisposeConcurrency: 1,
        })

        const disposePromise = manager.executeDispose()
        await flushPromises()

        expect(dependency2.isStarted).toBe(false)

        dependency1.resolve()
        await flushPromises()
        dependency2.resolve()
        await disposePromise
      })

      it.each([0, 1.5, -1, Number.NaN])('rejects maxConcurrency %s', async (maxConcurrency) => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })

        await expect(asyncDispose(diContainer, { maxConcurrency })).rejects.toThrow(
          `Expected maxConcurrency to be an integer from 1 and up or Infinity, got ${maxConcurrency}`,
        )
      })

      it('rejects with a concurrent dispose failure only after the other concurrent disposes settle without onDisposeError', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const disposeError = new Error('dispose failed')
        const failingDependency = new DeferredDispose()
        const slowDependency = new DeferredDispose()
        diContainer.register({
          dependency1: asFunction(() => failingDependency, {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
          dependency2: asFunction(() => slowDependency, {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
        })

        let isRejected = false
        const disposePromise = asyncDispose(diContainer).catch((error: unknown) => {
          isRejected = true
          return error
        })
        await flushPromises()
        failingDependency.reject(disposeError)
        await flushPromises()

        expect(slowDependency.isStarted).toBe(true)
        expect(isRejected).toBe(false)

        slowDependency.resolve()

        expect(await disposePromise).toBe(disposeError)
      })

      it('starts a concurrent dispose waiting for a slot even after another dispose failed', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const failingDependency = new DeferredDispose()
        const queuedDependency = new DeferredDispose()
        diContainer.register({
          dependency1: asFunction(() => failingDependency, {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
          dependency2: asFunction(() => queuedDependency, {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
        })
        const onDisposeError = vi.fn()

        const disposePromise = asyncDispose(diContainer, { maxConcurrency: 1, onDisposeError })
        await flushPromises()
        failingDependency.reject(new Error('dispose failed'))
        await flushPromises()

        expect(queuedDependency.isStarted).toBe(true)

        queuedDependency.resolve()
        await disposePromise

        expect(onDisposeError).toHaveBeenCalledTimes(1)
      })

      it('rejects with an error thrown by onDisposeError after the running concurrent disposes settle', async () => {
        const diContainer = createContainer({
          injectionMode: 'PROXY',
        })
        const handlerError = new Error('handler failed')
        const slowDependency = new DeferredDispose()
        diContainer.register({
          dependency1: asFunction(() => ({ asyncDispose: () => Promise.reject(new Error()) }), {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
          dependency2: asFunction(() => slowDependency, {
            lifetime: 'SINGLETON',
            asyncDispose: { concurrent: true },
          }),
        })

        let isRejected = false
        const disposePromise = asyncDispose(diContainer, {
          onDisposeError: () => {
            throw handlerError
          },
        }).catch((error: unknown) => {
          isRejected = true
          return error
        })
        await flushPromises()

        expect(slowDependency.isStarted).toBe(true)
        expect(isRejected).toBe(false)

        slowDependency.resolve()

        expect(await disposePromise).toBe(handlerError)
      })
    })

    it('finishes lower priorities before a concurrent dispose and the concurrent dispose before higher priorities', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      const lowerDependency = new DeferredDispose()
      const concurrentDependency = new DeferredDispose()
      const higherDependency = new DeferredDispose()
      diContainer.register({
        dependency1: asFunction(() => lowerDependency, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
          asyncDisposePriority: 1,
        }),
        dependency2: asFunction(() => concurrentDependency, {
          lifetime: 'SINGLETON',
          asyncDispose: { concurrent: true },
          asyncDisposePriority: 2,
        }),
        dependency3: asFunction(() => higherDependency, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
          asyncDisposePriority: 3,
        }),
      })

      const disposePromise = asyncDispose(diContainer)
      await flushPromises()

      expect(lowerDependency.isStarted).toBe(true)
      expect(concurrentDependency.isStarted).toBe(false)

      lowerDependency.resolve()
      await flushPromises()

      expect(concurrentDependency.isStarted).toBe(true)
      expect(higherDependency.isStarted).toBe(false)

      concurrentDependency.resolve()
      await flushPromises()

      expect(higherDependency.isStarted).toBe(true)

      higherDependency.resolve()
      await disposePromise
    })

    it('runs sequential disposes of the same priority in order while concurrent ones are pending', async () => {
      const loggedMessages: string[] = []
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      const concurrentDependency = new DeferredDispose()
      diContainer.register({
        dependency1: asFunction(() => concurrentDependency, {
          lifetime: 'SINGLETON',
          asyncDispose: { concurrent: true },
        }),
        dependency2: asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
        }),
        dependency3: asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
        }),
      })

      const disposePromise = asyncDispose(diContainer, {
        enableDebugLogging: true,
        loggerFn: (message) => loggedMessages.push(message),
      })
      await flushPromises()

      expect(loggedMessages).toEqual([
        'asyncDispose: dependency2 - started',
        'asyncDispose: dependency1 - started',
        'asyncDispose: dependency2 - finished',
        'asyncDispose: dependency3 - started',
        'asyncDispose: dependency3 - finished',
      ])

      concurrentDependency.resolve()
      await disposePromise

      expect(loggedMessages.at(-1)).toBe('asyncDispose: dependency1 - finished (concurrent)')
    })

    it('disposes every dependency when some fail and passes each failure to onDisposeError', async () => {
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      const disposeError1 = new Error('dispose 1 failed')
      const disposeError2 = new Error('dispose 2 failed')
      diContainer.register({
        dependency1: asFunction(() => ({ asyncDispose: () => Promise.reject(disposeError1) }), {
          lifetime: 'SINGLETON',
          asyncDispose: true,
        }),
        dependency2: asFunction(() => ({ close: () => Promise.reject(disposeError2) }), {
          lifetime: 'SINGLETON',
          asyncDispose: { method: 'close', concurrent: true },
        }),
        dependency3: asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
        }),
        dependency4: asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
          asyncDisposePriority: 2,
        }),
      })
      const onDisposeError = vi.fn()

      await asyncDispose(diContainer, { onDisposeError })

      expect(onDisposeError.mock.calls).toEqual([
        ['dependency1', disposeError1],
        ['dependency2', disposeError2],
      ])
      expect(diContainer.resolve<AsyncDisposeClass>('dependency3').isDisposed).toBe(true)
      expect(diContainer.resolve<AsyncDisposeClass>('dependency4').isDisposed).toBe(true)
    })

    it('logs each dispose when debug logging is enabled', async () => {
      const loggedMessages: string[] = []
      const diContainer = createContainer({
        injectionMode: 'PROXY',
      })
      diContainer.register({
        dependency1: asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: true,
        }),
        dependency2: asClass(AsyncDisposeClass, {
          lifetime: 'SINGLETON',
          asyncDispose: { concurrent: true },
          asyncDisposePriority: 2,
        }),
      })
      const manager = new AwilixManager({
        diContainer,
        enableDebugLogging: true,
        loggerFn: (message) => loggedMessages.push(message),
      })

      await manager.executeDispose()

      expect(loggedMessages).toEqual([
        'asyncDispose: dependency1 - started',
        'asyncDispose: dependency1 - finished',
        'asyncDispose: dependency2 - started',
        'asyncDispose: dependency2 - finished (concurrent)',
      ])
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
