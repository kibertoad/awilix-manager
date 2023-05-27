import { asClass, createContainer } from 'awilix'
import { describe, expect, it } from 'vitest'

import {asyncDispose, asyncInit, AwilixManager, eagerInject} from '../lib/awilixManager'

class AsyncInitClass {
  isInitted = false

  asyncInit() {
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
}

describe('awilixManager', () => {
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
        asyncInit: true
      })
      await manager.executeInit()

      const { dependency1, dependency2 } = diContainer.cradle

      expect(isInittedGlobal).toBe(true)
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
        eagerInject: true
      })
      manager.executeInit()

      expect(isInittedGlobal).toBe(true)
    })
  })
})
