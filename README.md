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
})
await awilixManager.executeInit() // this will not execute asyncInit, because consumer is disabled
await awilixManager.executeDispose() // this will not execute asyncDispose, because consumer is disabled
```
