// biome-ignore-all lint/suspicious/useAwait: mappers and sources must be async to match upstream's tests
import { getEventListeners } from 'node:events'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { pMap, pMapIterable, pMapSkip } from '../lib/pMap'

function delay<T = void>(ms: number, options?: { value: T }): Promise<T> {
  return sleep(ms, options?.value as T)
}

function timeSpan(): () => number {
  const start = performance.now()
  return () => performance.now() - start
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function assertInRange(value: number, { start = 0, end }: { start?: number; end: number }) {
  expect(value).toBeGreaterThanOrEqual(start)
  expect(value).toBeLessThanOrEqual(end)
}

type RejectionExpectations = {
  instanceOf?: abstract new (...args: any[]) => unknown
  message?: string
  name?: string
}

// Mirrors AVA's `t.throwsAsync`: the rejection must be an `Error`, and the error is returned for further checks.
async function expectRejection(
  thrower: Promise<unknown> | (() => Promise<unknown>),
  { instanceOf, message, name }: RejectionExpectations = {},
): Promise<any> {
  let didReject = false
  let error: any

  try {
    await (typeof thrower === 'function' ? thrower() : thrower)
  } catch (error_) {
    didReject = true
    error = error_
  }

  expect(didReject).toBe(true)
  expect(error).toBeInstanceOf(Error)

  if (instanceOf !== undefined) {
    expect(error).toBeInstanceOf(instanceOf)
  }

  if (message !== undefined) {
    expect(error.message).toBe(message)
  }

  if (name !== undefined) {
    expect(error.name).toBe(name)
  }

  return error
}

const sharedInput: any[] = [[async () => 10, 300], [20, 200], Promise.resolve([30, 100])]

const longerSharedInput: any[] = [
  [10, 300],
  [20, 200],
  [30, 100],
  [40, 50],
  [50, 25],
]

const errorInput1: any[] = [
  [20, 200],
  [30, 100],
  [
    async () => {
      throw new Error('foo')
    },
    10,
  ],
  [
    () => {
      throw new Error('bar')
    },
    10,
  ],
]

const errorInput2: any[] = [
  [20, 200],
  [
    async () => {
      throw new Error('bar')
    },
    10,
  ],
  [30, 100],
  [
    () => {
      throw new Error('foo')
    },
    10,
  ],
]

const errorInput3: any[] = [
  [20, 10],
  [
    async () => {
      throw new Error('bar')
    },
    100,
  ],
  [30, 100],
]

const mapper = async ([value, ms]: any): Promise<any> => {
  await delay(ms)

  if (typeof value === 'function') {
    value = await value()
  }

  return value
}

const mapperWithIndex = async ([value, ms]: any, index: number) => {
  await delay(ms)

  if (typeof value === 'function') {
    value = await value()
  }

  return { value, index }
}

class ThrowingIterator {
  index = 0
  private readonly max: number
  private readonly throwOnIndex: number

  constructor(max: number, throwOnIndex: number) {
    this.max = max
    this.throwOnIndex = throwOnIndex
  }

  [Symbol.iterator](): Iterator<number> {
    let index = 0
    return {
      next: () => {
        try {
          if (index === this.throwOnIndex) {
            throw new Error(`throwing on index ${index}`)
          }

          return { value: index, done: index === this.max } as IteratorResult<number>
        } finally {
          index++
          this.index = index
        }
      },
    }
  }
}

class AsyncTestData {
  private readonly data: any

  constructor(data: any) {
    this.data = data
  }

  async *[Symbol.asyncIterator]() {
    for (const item of this.data) {
      await delay(10)
      yield item
    }
  }
}

async function collectAsyncIterable<T>(asyncIterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []

  for await (const value of asyncIterable) {
    values.push(value)
  }

  return values
}

function createGate() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  return { gate, release }
}

// A source like a queue may block in `next()` after reporting `done`, so pulling again would hang. `for await` never pulls after `done`.
function exhaustibleSource(count: number) {
  let index = 0
  let isExhausted = false

  return {
    nextCallsAfterDone: 0,
    [Symbol.asyncIterator]() {
      return {
        next: async (): Promise<IteratorResult<number>> => {
          if (isExhausted) {
            this.nextCallsAfterDone++
            return { done: true, value: undefined }
          }

          if (index < count) {
            return { done: false, value: index++ }
          }

          isExhausted = true
          return { done: true, value: undefined }
        },
      }
    },
  }
}

describe('pMap', () => {
  it('main', async () => {
    const end = timeSpan()
    expect(await pMap(sharedInput, mapper)).toEqual([10, 20, 30])

    // We give it some leeway on both sides of the expected 300ms as the exact value depends on the machine and workload.
    assertInRange(end(), { start: 290, end: 430 })
  })

  it('concurrency: 1', async () => {
    const end = timeSpan()
    expect(await pMap(sharedInput, mapper, { concurrency: 1 })).toEqual([10, 20, 30])
    assertInRange(end(), { start: 590, end: 760 })
  })

  it('concurrency: 4', async () => {
    const concurrency = 4
    let running = 0

    await pMap(
      Array.from({ length: 100 }).fill(0),
      async () => {
        running++
        expect(running).toBeLessThanOrEqual(concurrency)
        await delay(randomInt(30, 200))
        running--
      },
      { concurrency },
    )
  })

  it('handles empty iterable', async () => {
    expect(await pMap([], mapper)).toEqual([])
  })

  it('async with concurrency: 2 (random time sequence)', async () => {
    const input = Array.from({ length: 10 }).map(() => randomInt(0, 100))
    const mapper = (value: number) => delay(value, { value })
    const result = await pMap(input, mapper, { concurrency: 2 })
    expect(result).toEqual(input)
  })

  it('async with concurrency: 2 (problematic time sequence)', async () => {
    const input = [100, 200, 10, 36, 13, 45]
    const mapper = (value: number) => delay(value, { value })
    const result = await pMap(input, mapper, { concurrency: 2 })
    expect(result).toEqual(input)
  })

  it('async with concurrency: 2 (out of order time sequence)', async () => {
    const input = [200, 100, 50]
    const mapper = (value: number) => delay(value, { value })
    const result = await pMap(input, mapper, { concurrency: 2 })
    expect(result).toEqual(input)
  })

  it('enforce number in options.concurrency', async () => {
    await expectRejection(
      pMap([], () => {}, { concurrency: 0 }),
      { instanceOf: TypeError },
    )
    await expectRejection(
      pMap([], () => {}, { concurrency: 1.5 }),
      { instanceOf: TypeError },
    )
    await expect(pMap([], () => {}, { concurrency: 1 })).resolves.toBeDefined()
    await expect(pMap([], () => {}, { concurrency: 10 })).resolves.toBeDefined()
    await expect(
      pMap([], () => {}, { concurrency: Number.POSITIVE_INFINITY }),
    ).resolves.toBeDefined()
  })

  it('immediately rejects when stopOnError is true', async () => {
    await expectRejection(pMap(errorInput1, mapper, { concurrency: 1 }), { message: 'foo' })
    await expectRejection(pMap(errorInput2, mapper, { concurrency: 1 }), { message: 'bar' })
  })

  it('aggregate errors when stopOnError is false', async () => {
    await expect(
      pMap(sharedInput, mapper, { concurrency: 1, stopOnError: false }),
    ).resolves.toBeDefined()
    await expectRejection(pMap(errorInput1, mapper, { concurrency: 1, stopOnError: false }), {
      instanceOf: AggregateError,
      message: '',
    })
    await expectRejection(pMap(errorInput2, mapper, { concurrency: 1, stopOnError: false }), {
      instanceOf: AggregateError,
      message: '',
    })
  })

  it('pMapSkip', async () => {
    expect(await pMap([1, pMapSkip, 2], async (value) => value)).toEqual([1, 2])
  })

  it('multiple pMapSkips', async () => {
    expect(
      await pMap([1, pMapSkip, 2, pMapSkip, 3, pMapSkip, pMapSkip, 4], async (value) => value),
    ).toEqual([1, 2, 3, 4])
  })

  it('all pMapSkips', async () => {
    expect(await pMap([pMapSkip, pMapSkip, pMapSkip, pMapSkip], async (value) => value)).toEqual([])
  })

  it('all mappers should run when concurrency is infinite, even after stop-on-error happened', async () => {
    const input: any[] = [1, async () => delay(300, { value: 2 }), 3]
    const mappedValues: unknown[] = []
    await expectRejection(
      pMap(input, async (value) => {
        value = typeof value === 'function' ? await value() : value
        mappedValues.push(value)
        if (value === 1) {
          await delay(100)
          throw new Error('Oops!')
        }
      }),
    )
    await delay(500)
    expect(mappedValues).toEqual([1, 3, 2])
  })

  it('asyncIterator - main', async () => {
    const end = timeSpan()
    expect(await pMap(new AsyncTestData(sharedInput), mapper)).toEqual([10, 20, 30])

    // We give it some leeway on both sides of the expected 300ms as the exact value depends on the machine and workload.
    assertInRange(end(), { start: 290, end: 430 })
  })

  it('asyncIterator - concurrency: 1', async () => {
    const end = timeSpan()
    expect(await pMap(new AsyncTestData(sharedInput), mapper, { concurrency: 1 })).toEqual([
      10, 20, 30,
    ])
    assertInRange(end(), { start: 590, end: 760 })
  })

  it('asyncIterator - concurrency: 4', async () => {
    const concurrency = 4
    let running = 0

    await pMap(
      new AsyncTestData(Array.from({ length: 100 }).fill(0)),
      async () => {
        running++
        expect(running).toBeLessThanOrEqual(concurrency)
        await delay(randomInt(30, 200))
        running--
      },
      { concurrency },
    )
  })

  it('asyncIterator - handles empty iterable', async () => {
    expect(await pMap(new AsyncTestData([]), mapper)).toEqual([])
  })

  it('asyncIterator - async with concurrency: 2 (random time sequence)', async () => {
    const input = Array.from({ length: 10 }).map(() => randomInt(0, 100))
    const mapper = (value: number) => delay(value, { value })
    const result = await pMap(new AsyncTestData(input), mapper, { concurrency: 2 })
    expect(result).toEqual(input)
  })

  it('asyncIterator - async with concurrency: 2 (problematic time sequence)', async () => {
    const input = [100, 200, 10, 36, 13, 45]
    const mapper = (value: number) => delay(value, { value })
    const result = await pMap(new AsyncTestData(input), mapper, { concurrency: 2 })
    expect(result).toEqual(input)
  })

  it('asyncIterator - async with concurrency: 2 (out of order time sequence)', async () => {
    const input = [200, 100, 50]
    const mapper = (value: number) => delay(value, { value })
    const result = await pMap(new AsyncTestData(input), mapper, { concurrency: 2 })
    expect(result).toEqual(input)
  })

  it('asyncIterator - enforce number in options.concurrency', async () => {
    await expectRejection(
      pMap(new AsyncTestData([]), () => {}, { concurrency: 0 }),
      {
        instanceOf: TypeError,
      },
    )
    await expectRejection(
      pMap(new AsyncTestData([]), () => {}, { concurrency: 1.5 }),
      {
        instanceOf: TypeError,
      },
    )
    await expect(pMap(new AsyncTestData([]), () => {}, { concurrency: 1 })).resolves.toBeDefined()
    await expect(pMap(new AsyncTestData([]), () => {}, { concurrency: 10 })).resolves.toBeDefined()
    await expect(
      pMap(new AsyncTestData([]), () => {}, { concurrency: Number.POSITIVE_INFINITY }),
    ).resolves.toBeDefined()
  })

  it('asyncIterator - immediately rejects when stopOnError is true', async () => {
    await expectRejection(pMap(new AsyncTestData(errorInput1), mapper, { concurrency: 1 }), {
      message: 'foo',
    })
    await expectRejection(pMap(new AsyncTestData(errorInput2), mapper, { concurrency: 1 }), {
      message: 'bar',
    })
  })

  it('asyncIterator - aggregate errors when stopOnError is false', async () => {
    await expect(
      pMap(new AsyncTestData(sharedInput), mapper, { concurrency: 1, stopOnError: false }),
    ).resolves.toBeDefined()
    await expectRejection(
      pMap(new AsyncTestData(errorInput1), mapper, { concurrency: 1, stopOnError: false }),
      { instanceOf: AggregateError, message: '' },
    )
    await expectRejection(
      pMap(new AsyncTestData(errorInput2), mapper, { concurrency: 1, stopOnError: false }),
      { instanceOf: AggregateError, message: '' },
    )
  })

  it('asyncIterator - pMapSkip', async () => {
    expect(await pMap(new AsyncTestData([1, pMapSkip, 2]), async (value) => value)).toEqual([1, 2])
  })

  it('asyncIterator - multiple pMapSkips', async () => {
    expect(
      await pMap(
        new AsyncTestData([1, pMapSkip, 2, pMapSkip, 3, pMapSkip, pMapSkip, 4]),
        async (value) => value,
      ),
    ).toEqual([1, 2, 3, 4])
  })

  it('asyncIterator - all pMapSkips', async () => {
    expect(
      await pMap(
        new AsyncTestData([pMapSkip, pMapSkip, pMapSkip, pMapSkip]),
        async (value) => value,
      ),
    ).toEqual([])
  })

  it('asyncIterator - all mappers should run when concurrency is infinite, even after stop-on-error happened', async () => {
    const input: any[] = [1, async () => delay(300, { value: 2 }), 3]
    const mappedValues: unknown[] = []
    await expectRejection(
      pMap(new AsyncTestData(input), async (value) => {
        if (typeof value === 'function') {
          value = await value()
        }

        mappedValues.push(value)
        if (value === 1) {
          await delay(100)
          throw new Error(`Oops! ${value}`)
        }
      }),
      { message: 'Oops! 1' },
    )
    await delay(500)
    expect(mappedValues).toEqual([1, 3, 2])
  })

  it('catches exception from source iterator - 1st item', async () => {
    const input = new ThrowingIterator(100, 0)
    const mappedValues: unknown[] = []
    const error = await expectRejection(
      pMap(
        input,
        async (value) => {
          mappedValues.push(value)
          await delay(100)
          return value
        },
        { concurrency: 1, stopOnError: true },
      ),
    )
    expect(error.message).toBe('throwing on index 0')
    expect(input.index).toBe(1)
    await delay(300)
    expect(mappedValues).toEqual([])
  })

  // The 2nd iterable item throwing is distinct from the 1st when concurrency is 1 because
  // it means that the source next() is invoked from next() and not from
  // the constructor
  it('catches exception from source iterator - 2nd item', async () => {
    const input = new ThrowingIterator(100, 1)
    const mappedValues: unknown[] = []
    await expectRejection(
      pMap(
        input,
        async (value) => {
          mappedValues.push(value)
          await delay(100)
          return value
        },
        { concurrency: 1, stopOnError: true },
      ),
    )
    await delay(300)
    expect(input.index).toBe(2)
    expect(mappedValues).toEqual([0])
  })

  // The 2nd iterable item throwing after a 1st item mapper exception, with stopOnError false,
  // is distinct from other cases because our next() is called from a catch block
  it('catches exception from source iterator - 2nd item after 1st item mapper throw', async () => {
    const input = new ThrowingIterator(100, 1)
    const mappedValues: unknown[] = []
    const error = await expectRejection(
      pMap(
        input,
        async (value) => {
          mappedValues.push(value)
          await delay(100)
          throw new Error('mapper threw error')
        },
        { concurrency: 1, stopOnError: false },
      ),
    )
    await delay(300)
    expect(error.message).toBe('throwing on index 1')
    expect(input.index).toBe(2)
    expect(mappedValues).toEqual([0])
  })

  // The iterator throwing after a mapper resolved, with stopOnError false, is distinct because
  // our next() is called from the mapper success path and must not double-decrement the in-flight count
  it('catches exception from source iterator - after a mapper resolved with stopOnError: false', async () => {
    const input = new ThrowingIterator(6, 3)
    const mappedValues: unknown[] = []
    const error = await expectRejection(
      pMap(
        input,
        async (value) => {
          mappedValues.push(value)
          await delay(50)
          return value
        },
        { concurrency: 2, stopOnError: false },
      ),
    )
    expect(error.message).toBe('throwing on index 3')
    expect(input.index).toBe(4)
    await delay(200)
    expect(input.index).toBe(4)
    expect(mappedValues).toEqual([0, 1, 2])
  })

  it('asyncIterator - catches exception from source iterator with stopOnError: false', async () => {
    let didThrow = false

    async function* source() {
      yield 0
      yield 1
      yield 2
      didThrow = true
      throw new Error('source failed')
    }

    const mappedValues: unknown[] = []
    const error = await expectRejection(
      pMap(
        source(),
        async (value) => {
          mappedValues.push(value)
          await delay(50)
          return value
        },
        { concurrency: 2, stopOnError: false },
      ),
    )
    expect(error.message).toBe('source failed')
    expect(didThrow).toBe(true)
    await delay(200)
    expect(mappedValues).toEqual([0, 1, 2])
  })

  it('aggregates rejected input elements when stopOnError is false', async () => {
    const input = [Promise.reject(new Error('input 0')), 1, Promise.reject(new Error('input 2')), 3]
    const mappedValues: unknown[] = []
    const error = await expectRejection(
      pMap(
        input,
        async (value) => {
          mappedValues.push(value)
          await delay(10)
          return value
        },
        { concurrency: 2, stopOnError: false },
      ),
      { instanceOf: AggregateError },
    )
    expect(error.errors.map((error: Error) => error.message)).toEqual(['input 0', 'input 2'])
    expect(mappedValues).toEqual([1, 3])
  })

  it('asyncIterator - get the correct exception after stop-on-error', async () => {
    const input: any[] = [
      1,
      async () => delay(200, { value: 2 }),
      async () => delay(300, { value: 3 }),
    ]
    const mappedValues: unknown[] = []

    const task = pMap(new AsyncTestData(input), async (value) => {
      if (typeof value === 'function') {
        value = await value()
      }

      mappedValues.push(value)
      // Throw for each item: all should fail and we should get only the first
      await delay(100)
      throw new Error(`Oops! ${value}`)
    })
    // Vitest fails the run on a rejection that is unhandled when it fires, even if it is awaited later. AVA does not.
    task.catch(() => {})
    await delay(500)
    await expectRejection(task, { message: 'Oops! 1' })
    expect(mappedValues).toEqual([1, 2, 3])
  })

  it('incorrect input type', async () => {
    let mapperCalled = false

    const task = pMap(123_456 as any, async () => {
      mapperCalled = true
      await delay(100)
    })
    task.catch(() => {})
    await delay(500)
    await expectRejection(task, {
      message: 'Expected `input` to be either an `Iterable` or `AsyncIterable`, got (number)',
    })
    expect(mapperCalled).toBe(false)
  })

  it('prefers the async iterator when the input has both, like `for await`', async () => {
    const input = {
      [Symbol.iterator](): Iterator<number> {
        throw new Error('sync iteration is not supported')
      },
      async *[Symbol.asyncIterator]() {
        yield 1
        yield 2
      },
    }

    expect(await pMap(input, (value) => value * 10)).toEqual([10, 20])
    expect(await collectAsyncIterable(pMapIterable(input, (value) => value * 10))).toEqual([10, 20])
  })

  it('no unhandled rejected promises from mapper throws - infinite concurrency', async () => {
    const input = [1, 2, 3]
    const mappedValues: unknown[] = []
    await expectRejection(
      pMap(input, async (value) => {
        mappedValues.push(value)
        await delay(100)
        throw new Error(`Oops! ${value}`)
      }),
      { message: 'Oops! 1' },
    )
    // All 3 mappers get invoked, all 3 throw, even with `{stopOnError: true}` this
    // should raise an AggregateError with all 3 exceptions instead of throwing 1
    // exception and hiding the other 2.
    expect(mappedValues).toEqual([1, 2, 3])
  })

  it('no unhandled rejected promises from mapper throws - concurrency 1', async () => {
    const input = [1, 2, 3]
    const mappedValues: unknown[] = []
    await expectRejection(
      pMap(
        input,
        async (value) => {
          mappedValues.push(value)
          await delay(100)
          throw new Error(`Oops! ${value}`)
        },
        { concurrency: 1 },
      ),
      { message: 'Oops! 1' },
    )
    expect(mappedValues).toEqual([1])
  })

  it('invalid mapper', async () => {
    await expectRejection(pMap([], 'invalid mapper' as any, { concurrency: 2 }), {
      instanceOf: TypeError,
    })
  })

  it('abort by AbortController', async () => {
    const abortController = new AbortController()

    setTimeout(() => {
      abortController.abort()
    }, 100)

    const mapper = async (value: unknown) => value

    await expectRejection(
      pMap([delay(1000), new AsyncTestData(100), 100], mapper, {
        signal: abortController.signal,
      }),
      { name: 'AbortError' },
    )
  })

  it('already aborted signal', async () => {
    const abortController = new AbortController()

    abortController.abort()

    const mapper = async (value: unknown) => value

    await expectRejection(
      pMap([delay(1000), new AsyncTestData(100), 100], mapper, {
        signal: abortController.signal,
      }),
      { name: 'AbortError' },
    )
    expect(getEventListeners(abortController.signal, 'abort').length).toBe(0)
  })

  it('pMapIterable', async () => {
    expect(await collectAsyncIterable(pMapIterable(sharedInput, mapper))).toEqual([10, 20, 30])
  })

  it('pMapIterable - index in mapper', async () => {
    expect(await collectAsyncIterable(pMapIterable(sharedInput, mapperWithIndex))).toEqual([
      { value: 10, index: 0 },
      { value: 20, index: 1 },
      { value: 30, index: 2 },
    ])
    expect(await collectAsyncIterable(pMapIterable(longerSharedInput, mapperWithIndex))).toEqual([
      { value: 10, index: 0 },
      { value: 20, index: 1 },
      { value: 30, index: 2 },
      { value: 40, index: 3 },
      { value: 50, index: 4 },
    ])
  })

  it('pMapIterable - index in mapper (out-of-order-settling promises)', async () => {
    const input = [delay(50, { value: 'a' }), delay(10, { value: 'b' }), delay(30, { value: 'c' })]

    const result: unknown[] = []
    for await (const item of pMapIterable(input, async (value, index) => [value, index], {
      concurrency: 3,
    })) {
      result.push(item)
    }

    expect(result).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
  })

  it('pMapIterable - empty', async () => {
    expect(await collectAsyncIterable(pMapIterable([], mapper))).toEqual([])
  })

  it('pMapIterable - iterable that throws', async () => {
    let isFirstNextCall = true

    const iterable = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<unknown>> {
            if (!isFirstNextCall) {
              return { done: true, value: undefined }
            }

            isFirstNextCall = false
            throw new Error('foo')
          },
        }
      },
    }

    const iterator = pMapIterable(iterable, mapper)[Symbol.asyncIterator]()

    await expectRejection(iterator.next(), { message: 'foo' })
  })

  it('pMapIterable - iterable that rejects with undefined', async () => {
    const iterable = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<unknown>> {
            return Promise.reject()
          },
        }
      },
    }

    const iterator = pMapIterable(iterable, mapper)[Symbol.asyncIterator]()
    let didReject = false
    let rejectionReason: unknown

    try {
      await iterator.next()
    } catch (error) {
      didReject = true
      rejectionReason = error
    }

    expect(didReject).toBe(true)
    expect(rejectionReason).toBe(undefined)
  })

  it('pMapIterable - no unhandled rejection when an in-flight `next()` rejects after an error', async () => {
    let nextCallCount = 0

    const iterable = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<number>> {
            nextCallCount++

            if (nextCallCount === 1) {
              return { done: false, value: 1 }
            }

            await delay(50)
            throw new Error('next() failed')
          },
        }
      },
    }

    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (error: unknown) => {
      unhandledRejections.push(error)
    }

    process.on('unhandledRejection', onUnhandledRejection)

    try {
      await expectRejection(
        collectAsyncIterable(
          pMapIterable(
            iterable,
            async () => {
              throw new Error('foo')
            },
            { concurrency: 2 },
          ),
        ),
        { message: 'foo' },
      )

      // Give the abandoned in-flight `next()` time to reject.
      await delay(200)
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }

    expect(unhandledRejections).toEqual([])
  })

  it('pMapIterable - mapper that throws', async () => {
    await expectRejection(
      collectAsyncIterable(
        pMapIterable(sharedInput, async () => {
          throw new Error('foo')
        }),
      ),
      { message: 'foo' },
    )
  })

  it('pMapIterable - stop on error', async () => {
    const output: unknown[] = []

    try {
      for await (const value of pMapIterable(errorInput3, mapper)) {
        output.push(value)
      }
    } catch (error) {
      expect((error as Error).message).toBe('bar')
    }

    expect(output).toEqual([20])
  })

  it('pMapIterable - concurrency: 1', async () => {
    const end = timeSpan()
    expect(
      await collectAsyncIterable(
        pMapIterable(sharedInput, mapper, {
          concurrency: 1,
          backpressure: Number.POSITIVE_INFINITY,
        }),
      ),
    ).toEqual([10, 20, 30])

    // It could've only taken this much time if each were run in series
    assertInRange(end(), { start: 590, end: 760 })
  })

  it('pMapIterable - concurrency: 2', async () => {
    const times = new Map<number, number>()
    const end = timeSpan()

    expect(
      await collectAsyncIterable(
        pMapIterable(
          longerSharedInput,
          (value) => {
            times.set(value[0], end())
            return mapper(value)
          },
          { concurrency: 2, backpressure: Number.POSITIVE_INFINITY },
        ),
      ),
    ).toEqual([10, 20, 30, 40, 50])

    assertInRange(times.get(10)!, { start: 0, end: 50 })
    assertInRange(times.get(20)!, { start: 0, end: 50 })
    assertInRange(times.get(30)!, { start: 200, end: 250 })
    assertInRange(times.get(40)!, { start: 300, end: 350 })
    assertInRange(times.get(50)!, { start: 300, end: 350 })
  })

  it('pMapIterable - backpressure', async () => {
    let currentValue: unknown

    // Concurrency option is forced by an early check
    const asyncIterator = pMapIterable(
      longerSharedInput,
      async (value) => {
        currentValue = await mapper(value)
        return currentValue
      },
      { backpressure: 2, concurrency: 2 },
    )[Symbol.asyncIterator]()

    const { value: value1 } = await asyncIterator.next()
    expect(value1).toBe(10)

    // If backpressure is not respected, than all items will be evaluated in this time
    await delay(600)

    expect(currentValue).toBe(30)

    const { value: value2 } = await asyncIterator.next()
    expect(value2).toBe(20)

    await delay(100)

    expect(currentValue).toBe(40)
  })

  it('pMapIterable - async input, backpressure > concurrency', async () => {
    async function* source() {
      yield 1
      yield 2
      yield 3
    }

    const log: number[] = []
    await collectAsyncIterable(
      pMapIterable(
        source(),
        async (n) => {
          log.push(n)
          await delay(100)
          log.push(n)
        },
        { concurrency: 1, backpressure: 2 },
      ),
    )

    expect(log).toEqual([1, 1, 2, 2, 3, 3])
  })

  it('rejects a pMapIterable backpressure below the concurrency', () => {
    expect(() =>
      pMapIterable([], async (value) => value, { concurrency: 2, backpressure: 1 }),
    ).toThrow(
      'Expected `backpressure` to be an integer from `concurrency` (2) and up or `Infinity`, got `1` (number)',
    )
  })

  it('pMapIterable - pMapSkip', async () => {
    expect(
      await collectAsyncIterable(pMapIterable([1, pMapSkip, 2], async (value) => value)),
    ).toEqual([1, 2])
  })

  it('pMapIterable - stops pulling input after the consumer breaks', async () => {
    const { gate, release } = createGate()

    let mapperCalls = 0

    async function* source() {
      for (let index = 0; index < 100; index++) {
        yield index
      }
    }

    const iterator = pMapIterable(
      source(),
      async (value) => {
        mapperCalls++

        if (value > 0) {
          await gate
          return pMapSkip
        }

        return value
      },
      { concurrency: 2, backpressure: 2 },
    )

    for await (const value of iterator) {
      expect(value).toBe(0)
      break
    }

    expect(mapperCalls).toBe(3)

    release()
    await delay(50)

    expect(mapperCalls).toBe(3)
  })

  it('pMapIterable - stops pulling input after `return()` is called', async () => {
    const { gate, release } = createGate()

    let mapperCalls = 0

    const iterator = pMapIterable(
      Array.from({ length: 100 }, (_, index) => index),
      async (value) => {
        mapperCalls++

        if (value > 0) {
          await gate
          return pMapSkip
        }

        return value
      },
      { concurrency: 2, backpressure: 2 },
    )[Symbol.asyncIterator]()

    expect(await iterator.next()).toEqual({ value: 0, done: false })
    expect(await iterator.return!()).toEqual({ value: undefined, done: true })
    expect(mapperCalls).toBe(3)

    release()
    await delay(50)

    expect(mapperCalls).toBe(3)
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
  })

  it('pMapIterable - stops pulling input after the consumer throws', async () => {
    const { gate, release } = createGate()

    let mapperCalls = 0

    async function* source() {
      for (let index = 0; index < 100; index++) {
        yield index
      }
    }

    const iterable = pMapIterable(
      source(),
      async (value) => {
        mapperCalls++

        if (value > 0) {
          await gate
          return pMapSkip
        }

        return value
      },
      { concurrency: 2, backpressure: 2 },
    )

    await expectRejection(
      async () => {
        for await (const value of iterable) {
          throw new Error(`consumer error ${value}`)
        }
      },
      { message: 'consumer error 0' },
    )

    expect(mapperCalls).toBe(3)

    release()
    await delay(50)

    expect(mapperCalls).toBe(3)
  })

  it('pMapIterable - in-flight mappers still settle after the consumer breaks', async () => {
    const { gate, release } = createGate()

    const settled: number[] = []

    async function* source() {
      for (let index = 0; index < 100; index++) {
        yield index
      }
    }

    const iterable = pMapIterable(
      source(),
      async (value) => {
        if (value > 0) {
          await gate
        }

        settled.push(value)
        return value
      },
      { concurrency: 3, backpressure: 3 },
    )

    for await (const value of iterable) {
      expect(value).toBe(0)
      break
    }

    expect(settled).toEqual([0])

    release()
    await delay(50)

    expect(settled).toEqual([0, 1, 2, 3])
  })

  it('pMapIterable - does not call the mapper for input that arrives after the consumer breaks', async () => {
    const { gate, release } = createGate()

    const mappedValues: number[] = []

    async function* source() {
      yield 0
      await gate
      yield 1
      yield 2
    }

    for await (const value of pMapIterable(
      source(),
      async (value) => {
        mappedValues.push(value)
        return value
      },
      { concurrency: 2 },
    )) {
      expect(value).toBe(0)
      break
    }

    release()
    await delay(50)

    expect(mappedValues).toEqual([0])
  })

  it('pMapIterable - does not call the mapper for promise input that settles after the consumer breaks', async () => {
    const { gate, release } = createGate()

    const mappedValues: number[] = []
    const input = [0, gate.then(() => 1), gate.then(() => 2)]

    for await (const value of pMapIterable(
      input,
      async (value) => {
        mappedValues.push(value)
        return value
      },
      { concurrency: 3 },
    )) {
      expect(value).toBe(0)
      break
    }

    release()
    await delay(50)

    expect(mappedValues).toEqual([0])
  })

  it('pMapIterable - does not call the mapper for input that arrives after a mapper throws', async () => {
    const { gate, release } = createGate()

    const mappedValues: number[] = []

    async function* source() {
      yield 0
      await gate
      yield 1
    }

    await expectRejection(
      collectAsyncIterable(
        pMapIterable(
          source(),
          async (value) => {
            mappedValues.push(value)
            throw new Error(`mapper error ${value}`)
          },
          { concurrency: 2 },
        ),
      ),
      { message: 'mapper error 0' },
    )

    release()
    await delay(50)

    expect(mappedValues).toEqual([0])
  })

  it('pMapIterable - does not call the mapper for input that arrives after `return()` is called', async () => {
    const { gate, release } = createGate()

    const mappedValues: number[] = []

    async function* source() {
      yield 0
      await gate
      yield 1
    }

    const iterator = pMapIterable(
      source(),
      async (value) => {
        mappedValues.push(value)
        return value
      },
      { concurrency: 2 },
    )[Symbol.asyncIterator]()

    expect(await iterator.next()).toEqual({ value: 0, done: false })
    expect(await iterator.return!()).toEqual({ value: undefined, done: true })

    release()
    await delay(50)

    expect(mappedValues).toEqual([0])
  })

  it('pMapIterable - drops pending earlier input when a later mapper throws', async () => {
    const { gate, release } = createGate()

    const mappedValues: number[] = []
    const input = [gate.then(() => 0), 1]

    const promise = expectRejection(
      collectAsyncIterable(
        pMapIterable(
          input,
          async (value) => {
            mappedValues.push(value)
            throw new Error(`mapper error ${value}`)
          },
          { concurrency: 2 },
        ),
      ),
    )

    await delay(10)
    expect(mappedValues).toEqual([1])

    release()
    const error = await promise
    expect(error.message).toBe('mapper error 1')
    expect(mappedValues).toEqual([1])
  })

  it('pMapIterable - closes the source iterator when the consumer breaks', async () => {
    let isSourceClosed = false

    async function* source() {
      try {
        for (let index = 0; index < 100; index++) {
          yield index
        }
      } finally {
        isSourceClosed = true
      }
    }

    for await (const value of pMapIterable(source(), async (value) => value, {
      concurrency: 2,
    })) {
      expect(value).toBe(0)
      break
    }

    await delay(10)
    expect(isSourceClosed).toBe(true)
  })

  it('pMapIterable - closes the source iterator when the consumer throws', async () => {
    let isSourceClosed = false

    async function* source() {
      try {
        for (let index = 0; index < 100; index++) {
          yield index
        }
      } finally {
        isSourceClosed = true
      }
    }

    await expectRejection(
      async () => {
        for await (const value of pMapIterable(source(), async (value) => value, {
          concurrency: 2,
        })) {
          throw new Error(`consumer error ${value}`)
        }
      },
      { message: 'consumer error 0' },
    )

    await delay(10)
    expect(isSourceClosed).toBe(true)
  })

  it('pMapIterable - closes the source iterator when the mapper throws', async () => {
    let isSourceClosed = false

    async function* source() {
      try {
        for (let index = 0; index < 100; index++) {
          yield index
        }
      } finally {
        isSourceClosed = true
      }
    }

    await expectRejection(
      collectAsyncIterable(
        pMapIterable(
          source(),
          async (value) => {
            if (value === 1) {
              throw new Error('mapper error')
            }

            return value
          },
          { concurrency: 2 },
        ),
      ),
      { message: 'mapper error' },
    )

    await delay(10)
    expect(isSourceClosed).toBe(true)
  })

  it('pMapIterable - closes a sync source iterator when `return()` is called', async () => {
    let returnCallCount = 0

    const iterable = {
      [Symbol.iterator](): Iterator<number> {
        let index = 0
        return {
          next: () => ({ done: false, value: index++ }),
          return() {
            returnCallCount++
            return { done: true, value: undefined }
          },
        }
      },
    }

    const iterator = pMapIterable(iterable, async (value) => value, {
      concurrency: 2,
    })[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ value: 0, done: false })
    expect(await iterator.return!()).toEqual({ value: undefined, done: true })
    expect(returnCallCount).toBe(1)
  })

  it('pMapIterable - does not close the source iterator before it is exhausted', async () => {
    let isSourceClosed = false
    let isSourceExhausted = false

    async function* source() {
      try {
        yield 1
        yield 2
        isSourceExhausted = true
      } finally {
        isSourceClosed = true
      }
    }

    expect(
      await collectAsyncIterable(
        pMapIterable(source(), async (value) => value, { concurrency: 1 }),
      ),
    ).toEqual([1, 2])
    expect(isSourceExhausted).toBe(true)
    expect(isSourceClosed).toBe(true)
  })

  it('pMapIterable - a source `return()` that rejects does not affect the consumer', async () => {
    const iterable = {
      [Symbol.asyncIterator]() {
        let index = 0
        return {
          async next(): Promise<IteratorResult<number>> {
            return { done: false, value: index++ }
          },
          async return(): Promise<IteratorResult<number>> {
            throw new Error('return failed')
          },
        }
      },
    }

    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (error: unknown) => {
      unhandledRejections.push(error)
    }

    process.on('unhandledRejection', onUnhandledRejection)

    try {
      for await (const value of pMapIterable(iterable, async (value) => value, {
        concurrency: 2,
      })) {
        expect(value).toBe(0)
        break
      }

      await delay(50)
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }

    expect(unhandledRejections).toEqual([])
  })

  it('pMapIterable - a source blocked in `next()` does not block the consumer from stopping', async () => {
    async function* source() {
      yield 0
      await new Promise(() => {}) // Never settles
    }

    const end = timeSpan()

    for await (const value of pMapIterable(source(), async (value) => value, {
      concurrency: 2,
    })) {
      expect(value).toBe(0)
      break
    }

    expect(end()).toBeLessThan(100)
  })

  it('closes the source iterator when a mapper rejects', async () => {
    let isSourceClosed = false

    async function* source() {
      try {
        for (let index = 0; index < 100; index++) {
          yield index
        }
      } finally {
        isSourceClosed = true
      }
    }

    await expectRejection(
      pMap(
        source(),
        async (value) => {
          if (value === 1) {
            throw new Error('mapper error')
          }

          await delay(10)
          return value
        },
        { concurrency: 2 },
      ),
      { message: 'mapper error' },
    )

    await delay(10)
    expect(isSourceClosed).toBe(true)
  })

  it('closes the source iterator when aborted', async () => {
    let returnCallCount = 0

    const iterable = {
      [Symbol.iterator](): Iterator<number> {
        let index = 0
        return {
          next: () => ({ done: false, value: index++ }),
          return() {
            returnCallCount++
            return { done: true, value: undefined }
          },
        }
      },
    }

    const abortController = new AbortController()

    setTimeout(() => {
      abortController.abort()
    }, 50)

    await expectRejection(
      pMap(iterable, () => delay(1000), { concurrency: 2, signal: abortController.signal }),
      { name: 'AbortError' },
    )
    expect(returnCallCount).toBe(1)
  })

  it('does not close the source iterator when it completes', async () => {
    let returnCallCount = 0

    const iterable = {
      [Symbol.iterator](): Iterator<number> {
        let index = 0
        return {
          next: () => ({ done: index === 3, value: index++ }) as IteratorResult<number>,
          return() {
            returnCallCount++
            return { done: true, value: undefined }
          },
        }
      },
    }

    expect(await pMap(iterable, async (value) => value, { concurrency: 2 })).toEqual([0, 1, 2])
    expect(returnCallCount).toBe(0)

    await expectRejection(
      pMap(
        iterable,
        async () => {
          throw new Error('mapper error')
        },
        { concurrency: 2, stopOnError: false },
      ),
      { instanceOf: AggregateError },
    )
    expect(returnCallCount).toBe(0)
  })

  it('a source `return()` that rejects does not affect the `pMap` rejection', async () => {
    const iterable = {
      [Symbol.asyncIterator]() {
        let index = 0
        return {
          async next(): Promise<IteratorResult<number>> {
            return { done: false, value: index++ }
          },
          async return(): Promise<IteratorResult<number>> {
            throw new Error('return failed')
          },
        }
      },
    }

    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (error: unknown) => {
      unhandledRejections.push(error)
    }

    process.on('unhandledRejection', onUnhandledRejection)

    try {
      await expectRejection(
        pMap(
          iterable,
          async () => {
            throw new Error('mapper error')
          },
          { concurrency: 2 },
        ),
        { message: 'mapper error' },
      )

      await delay(50)
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }

    expect(unhandledRejections).toEqual([])
  })

  it('pMapIterable - does not call `return()` on an exhausted source iterator', async () => {
    let returnCallCount = 0

    const iterable = {
      [Symbol.iterator](): Iterator<number> {
        let index = 0
        return {
          next: () => ({ done: index === 3, value: index++ }) as IteratorResult<number>,
          return() {
            returnCallCount++
            return { done: true, value: undefined }
          },
        }
      },
    }

    expect(
      await collectAsyncIterable(
        pMapIterable(iterable, async (value) => value, { concurrency: 2 }),
      ),
    ).toEqual([0, 1, 2])
    expect(returnCallCount).toBe(0)
  })

  it('does not call `next()` on an exhausted source iterator', async () => {
    const source = exhaustibleSource(3)

    expect(
      await pMap(
        source,
        async (value) => {
          await delay(10)
          return value
        },
        { concurrency: 2 },
      ),
    ).toEqual([0, 1, 2])
    expect(source.nextCallsAfterDone).toBe(0)
  })

  it('asyncIterator - does not call `next()` on an exhausted source iterator with stopOnError: false', async () => {
    const source = exhaustibleSource(3)

    await expectRejection(
      pMap(
        source,
        async (value) => {
          await delay(10)
          throw new Error(`mapper error ${value}`)
        },
        { concurrency: 2, stopOnError: false },
      ),
      { instanceOf: AggregateError },
    )
    expect(source.nextCallsAfterDone).toBe(0)
  })

  it('pMapIterable - does not call `next()` on an exhausted source iterator', async () => {
    const source = exhaustibleSource(3)

    expect(
      await collectAsyncIterable(
        pMapIterable(
          source,
          async (value) => {
            await delay(10)
            return value
          },
          { concurrency: 2, backpressure: 4 },
        ),
      ),
    ).toEqual([0, 1, 2])
    await delay(10)
    expect(source.nextCallsAfterDone).toBe(0)
  })

  it('does not call `next()` on an exhausted sync source iterator', async () => {
    let nextCallsAfterDone = 0

    const source = {
      [Symbol.iterator](): Iterator<number> {
        let index = 0
        return {
          next() {
            if (index > 3) {
              nextCallsAfterDone++
            }

            return { done: index === 3, value: index++ } as IteratorResult<number>
          },
        }
      },
    }

    expect(
      await pMap(source, async (value) => {
        await delay(10)
        return value
      }),
    ).toEqual([0, 1, 2])
    expect(nextCallsAfterDone).toBe(0)
  })

  it('pMapIterable - does not call `next()` on an exhausted source iterator when mappers skip', async () => {
    const source = exhaustibleSource(4)

    expect(
      await collectAsyncIterable(
        pMapIterable(
          source,
          async (value) => {
            await delay(10)
            return value % 2 === 0 ? pMapSkip : value
          },
          { concurrency: 2, backpressure: 4 },
        ),
      ),
    ).toEqual([1, 3])
    await delay(10)
    expect(source.nextCallsAfterDone).toBe(0)
  })
})
