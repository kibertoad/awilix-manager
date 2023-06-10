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
        eagerInject: true, // this will be constructed and cached immediately
    }),
)

const awilixManager = new AwilixManager()
await awilixManager.executeInit() // this will execute eagerInject and asyncInit
await awilixManager.executeDispose() // this will execute asyncDispose
```
