# awilix-manager

[![NPM Version](https://img.shields.io/npm/v/awilix-manager.svg)](https://npmjs.org/package/awilix-manager)
[![Build Status](https://github.com/kibertoad/awilix-manager/workflows/ci/badge.svg)](https://github.com/kibertoad/awilix-manager/actions)
[![Coverage Status](https://coveralls.io/repos/kibertoad/awilix-manager/badge.svg?branch=main)](https://coveralls.io/r/kibertoad/awilix-manager?branch=main)

Wrapper over awilix to support more complex use-cases

## Getting started

First install the package:

```bash
npm i awilix-manager
```

Next, set up your DI configuration:

```js
import { AwilixManager } from 'awilix-manager'
import { asClass, createContainer } from 'awilix'

class AsyncClass {
  async init() {
    // init logic
  }

  async dispose() {
    // dispose logic
  }
}

const diContainer = createContainer({
  injectionMode: 'PROXY',
})

diContainer.register(
  'dependency1',
  asClass(AsyncClass, {
    lifetime: 'SINGLETON',
    asyncInitPriority: 10, // lower value means its initted earlier
    asyncDisposePriority: 10, // lower value means its disposed earlier
    asyncInit: 'init',
    asyncDispose: 'dispose',
    eagerInject: true, // this will be constructed and cached immediately. Redundant for resolves with `asyncInit` parameter set, as that is always resolved eagerly. If a string is passed, then additional synchronous method will be invoked in addition to constructor on injection.
  }),
)

const awilixManager = new AwilixManager({
  diContainer,
  asyncInit: true,
  asyncDispose: true,
  strictBooleanEnforced: true,  
})
await awilixManager.executeInit() // this will execute eagerInject and asyncInit
await awilixManager.executeDispose() // this will execute asyncDispose
```

## Disabling eager injection conditionally

In some cases you may want to prevent eager injection and async disposal of some of your dependencies - e. g. when you want to disable all of your background jobs or message consumers in some of your integration tests.
You can use `enabled` resolver parameter for that:

```js
import { AwilixManager } from 'awilix-manager'
import { asClass, createContainer } from 'awilix'

class QueueConsumerClass {
  async consume() {
    // consumer registration logic
  }

  async destroy() {
    // dispose logic
  }
}

const diContainer = createContainer({
  injectionMode: 'PROXY',
})

const isAMQPEnabled = false // disable consumers, e. g. for tests

diContainer.register(
  'dependency1',
  asClass(QueueConsumerClass, {
    lifetime: 'SINGLETON',
    asyncInitPriority: 10, // lower value means its initted earlier
    asyncDisposePriority: 10, // lower value means its disposed earlier
    asyncInit: 'consume',
    asyncDispose: 'destroy',
    enabled: isAMQPEnabled, // default is true
  }),
)

const awilixManager = new AwilixManager({
  diContainer,
  asyncInit: true,
  asyncDispose: true,
  strictBooleanEnforced: true,    
})
await awilixManager.executeInit() // this will not execute asyncInit, because consumer is disabled
await awilixManager.executeDispose() // this will not execute asyncDispose, because consumer is disabled
```

Note that passing `undefined` or `null` as a value for the `enabled` parameter counts as a default, which is `true`. That may lead to hard-to-debug errors, as it may be erroneously assumed that passing falsy value should equal to passing `false`. In order to prevent this, it is recommended to set `strictBooleanEnforced` flag to `true`, which would throw an error if a non-boolean value is explicitly set to the `enabled` field. In future semver major release this will become a default behaviour.

## Fetching dependencies based on tags

In some cases you may want to get dependencies based on a supplied list of tags. 
You can use `tags` parameter in conjunction with the `getWithTags` method for that:

```js
import { AwilixManager } from 'awilix-manager'
import { asClass, createContainer } from 'awilix'

const diContainer = createContainer({
  injectionMode: 'PROXY',
})

class QueueConsumerHighPriorityClass {
}

class QueueConsumerLowPriorityClass {
}

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

// This will return dependency1 and dependency2
const result1 = awilixManager.getWithTags(diContainer, ['queue'])
// This will return only dependency2
const result2 = awilixManager.getWithTags(diContainer, ['queue', 'low-priority'])
```

## Type-safe resolver definition

You can use `ResolvedDependencies` for defining your DI configuration as an object:

```ts
type DiContainerType = {
    testClass: TestClass
}
const diConfiguration: ResolvedDependencies<DiContainerType> = {
    testClass: asClass(TestClass),
}

const diContainer = createContainer<DiContainerType>({
    injectionMode: 'PROXY',
})

for (const [dependencyKey, dependencyValue] of Object.entries(diConfiguration)) {
    diContainer.register(dependencyKey, dependencyValue as Resolver<unknown>)
}
```

## Mocking dependencies

Sometimes you may want to intentionally inject objects that do not fully conform to the type definition of an original class. For that you can use `asMockClass` resolver:

```ts
type DiContainerType = {
    realClass: RealClass
    realClass2: RealClass
}
const diConfiguration: ResolvedDependencies<DiContainerType> = {
    realClass: asClass(RealClass),
    realClass2: asMockClass(FakeClass),
}

const diContainer = createContainer<DiContainerType>({
    injectionMode: 'PROXY',
})

for (const [dependencyKey, dependencyValue] of Object.entries(diConfiguration)) {
    diContainer.register(dependencyKey, dependencyValue as Resolver<unknown>)
}

const { realClass, realClass2 } = diContainer.cradle
expect(realClass).toBeInstanceOf(RealClass)
expect(realClass2).toBeInstanceOf(FakeClass)
```
