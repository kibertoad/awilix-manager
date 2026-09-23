/*
Ported from p-map 7.0.8 (https://github.com/sindresorhus/p-map, commit bc8380d),
which is ESM-only and so cannot be loaded by this CommonJS package without require(esm).
Keep the logic in step with upstream, so fixes there can be carried over.

MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

type BaseOptions = {
  /**
  Number of concurrently pending promises returned by `mapper`.

  Must be an integer from 1 and up or `Infinity`.

  @default Infinity
  */
  readonly concurrency?: number
}

export type Options = BaseOptions & {
  /**
  When `true`, the first mapper rejection will be rejected back to the consumer.

  When `false`, instead of stopping when a promise rejects, it will wait for all the promises to settle and then reject with an `AggregateError` containing all the errors from the rejected promises.

  Caveat: When `true`, any already-started async mappers will continue to run until they resolve or reject. In the case of infinite concurrency with sync iterables, *all* mappers are invoked on startup and will continue after the first rejection. Use the `signal` option for abort control.

  @default true
  */
  readonly stopOnError?: boolean

  /**
  You can abort the promises using `AbortController`.
  */
  readonly signal?: AbortSignal | undefined
}

export type IterableOptions = BaseOptions & {
  /**
  Maximum number of promises returned by `mapper` that have resolved but not yet collected by the consumer of the async iterable. Calls to `mapper` will be limited so that there is never too much backpressure.

  Default: `options.concurrency`
  */
  readonly backpressure?: number
}

type MaybePromise<T> = T | Promise<T>

/**
Return this value from a `mapper` function to skip including the value in the returned array.
*/
export const pMapSkip: unique symbol = Symbol('skip')

/**
Function which is called for every item in `input`. Expected to return a `Promise` or value.

@param element - Iterated element.
@param index - Index of the element in the source array.
*/
export type Mapper<Element = any, NewElement = unknown> = (
  element: Element,
  index: number,
) => MaybePromise<NewElement | typeof pMapSkip>

type Input<Element> =
  | AsyncIterable<Element | Promise<Element>>
  | Iterable<Element | Promise<Element>>

type AnyIterator<Element> =
  | Iterator<Element | Promise<Element>>
  | AsyncIterator<Element | Promise<Element>>

function isValidConcurrency(concurrency: number): boolean {
  return (
    (Number.isSafeInteger(concurrency) && concurrency >= 1) ||
    concurrency === Number.POSITIVE_INFINITY
  )
}

function validateInput(iterable: any, mapper: unknown, concurrency: number): void {
  if (iterable[Symbol.iterator] === undefined && iterable[Symbol.asyncIterator] === undefined) {
    throw new TypeError(
      `Expected \`input\` to be either an \`Iterable\` or \`AsyncIterable\`, got (${typeof iterable})`,
    )
  }

  if (typeof mapper !== 'function') {
    throw new TypeError('Mapper function is required')
  }

  if (!isValidConcurrency(concurrency)) {
    throw new TypeError(
      `Expected \`concurrency\` to be an integer from 1 and up or \`Infinity\`, got \`${concurrency}\` (${typeof concurrency})`,
    )
  }
}

function getIterator<Element>(iterable: Input<Element>): AnyIterator<Element> {
  return (iterable as any)[Symbol.asyncIterator] === undefined
    ? (iterable as Iterable<Element | Promise<Element>>)[Symbol.iterator]()
    : (iterable as AsyncIterable<Element | Promise<Element>>)[Symbol.asyncIterator]()
}

/**
@param input - Synchronous or asynchronous iterable that is iterated over concurrently, calling the `mapper` function for each element. Each iterated item is `await`'d before the `mapper` is invoked so the iterable may return a `Promise` that resolves to an item.
@param mapper - Function which is called for every item in `input`. Expected to return a `Promise` or value.
@returns A `Promise` that is fulfilled when all promises in `input` and the ones returned from `mapper` are fulfilled, or rejects if any of the promises reject. The fulfilled value is an `Array` of the fulfilled values returned from `mapper` in `input` order.
*/
export function pMap<Element, NewElement>(
  iterable: Input<Element>,
  mapper: Mapper<Element, NewElement>,
  { concurrency = Number.POSITIVE_INFINITY, stopOnError = true, signal }: Options = {},
): Promise<Array<Exclude<NewElement, typeof pMapSkip>>> {
  return new Promise((resolve_, reject_) => {
    validateInput(iterable, mapper, concurrency)

    const result: unknown[] = []
    const errors: unknown[] = []
    const skippedIndexesMap = new Map<number, unknown>()
    let isRejected = false
    let isResolved = false
    let isIterableDone = false
    let resolvingCount = 0
    let currentIndex = 0
    const iterator = getIterator(iterable)

    const signalListener = () => {
      reject(signal?.reason)
    }

    const cleanup = () => {
      signal?.removeEventListener('abort', signalListener)
    }

    const resolve = (value: unknown[]) => {
      resolve_(value as Array<Exclude<NewElement, typeof pMapSkip>>)
      cleanup()
    }

    const reject = (reason: unknown) => {
      if (isResolved) {
        return
      }

      isRejected = true
      isResolved = true
      reject_(reason)
      cleanup()

      if (!isIterableDone) {
        void closeIterator(iterator)
      }
    }

    if (signal) {
      if (signal.aborted) {
        reject(signal.reason)
        return
      }

      signal.addEventListener('abort', signalListener, { once: true })
    }

    const next = async (): Promise<void> => {
      if (isResolved) {
        return
      }

      // Once the source reported `done`, don't pull again like `for await`. A source like a queue may block in `next()` after it is exhausted, which would hang the completion below.
      const nextItem: IteratorResult<Element | Promise<Element>> = isIterableDone
        ? { done: true, value: undefined }
        : await iterator.next()

      const index = currentIndex
      currentIndex++

      // `iterator.next()` can be called many times in parallel.
      // This can cause multiple calls to this `next()` function to
      // receive a `nextItem` with `done === true`.
      // The shutdown logic that rejects/resolves must be protected
      // so it runs only one time as the `skippedIndex` logic is
      // non-idempotent.
      if (nextItem.done) {
        isIterableDone = true

        if (resolvingCount === 0 && !isResolved) {
          if (!stopOnError && errors.length > 0) {
            reject(new AggregateError(errors))
            return
          }

          isResolved = true

          if (skippedIndexesMap.size === 0) {
            resolve(result)
            return
          }

          const pureResult: unknown[] = []

          // Support multiple `pMapSkip`'s.
          for (const [index, value] of result.entries()) {
            if (skippedIndexesMap.get(index) === pMapSkip) {
              continue
            }

            pureResult.push(value)
          }

          resolve(pureResult)
        }

        return
      }

      resolvingCount++

      // Intentionally detached
      void (async () => {
        try {
          const element = await nextItem.value

          if (isResolved) {
            return
          }

          const value = await mapper(element, index)

          // Use Map to stage the index of the element.
          if (value === pMapSkip) {
            skippedIndexesMap.set(index, value)
          }

          result[index] = value
        } catch (error) {
          if (stopOnError) {
            reject(error)
            return
          }

          errors.push(error)
        }

        resolvingCount--

        // If the iterable throws we can't really continue regardless of `stopOnError` state
        // since an iterable is likely to continue throwing after it throws once.
        // If we continue calling `next()` indefinitely we will likely end up
        // in an infinite loop of failed iteration.
        try {
          await next()
        } catch (error) {
          reject(error)
        }
      })()
    }

    // Create the concurrent runners in a detached (non-awaited)
    // promise. We need this so we can await the `next()` calls
    // to stop creating runners before hitting the concurrency limit
    // if the iterable has already been marked as done.
    // We *must* do this for async iterators otherwise we'll spin up
    // infinite `next()` calls by default and never start the event loop.
    void (async () => {
      for (let index = 0; index < concurrency; index++) {
        try {
          await next()
        } catch (error) {
          reject(error)
          break
        }

        if (isIterableDone || isRejected) {
          break
        }
      }
    })()
  })
}

type IterableSlot<NewElement> =
  | { done: true }
  | { done: false; value: NewElement | typeof pMapSkip }
  | { error: unknown }

/**
@param input - Synchronous or asynchronous iterable that is iterated over concurrently, calling the `mapper` function for each element. Each iterated item is `await`'d before the `mapper` is invoked so the iterable may return a `Promise` that resolves to an item.
@param mapper - Function which is called for every item in `input`. Expected to return a `Promise` or value.
@returns An async iterable that streams each return value from `mapper` in order.
*/
export function pMapIterable<Element, NewElement>(
  iterable: Input<Element>,
  mapper: Mapper<Element, NewElement>,
  { concurrency = Number.POSITIVE_INFINITY, backpressure = concurrency }: IterableOptions = {},
): AsyncIterable<Exclude<NewElement, typeof pMapSkip>> {
  validateInput(iterable, mapper, concurrency)

  if (
    !(
      (Number.isSafeInteger(backpressure) && backpressure >= concurrency) ||
      backpressure === Number.POSITIVE_INFINITY
    )
  ) {
    throw new TypeError(
      `Expected \`backpressure\` to be an integer from \`concurrency\` (${concurrency}) and up or \`Infinity\`, got \`${backpressure}\` (${typeof backpressure})`,
    )
  }

  return {
    async *[Symbol.asyncIterator]() {
      const iterator = getIterator(iterable)

      const promises: Promise<IterableSlot<NewElement>>[] = []
      let pendingPromisesCount = 0
      let isDone = false
      let isIterableDone = false
      let index = 0

      function trySpawn() {
        // Don't pull again once the source reported `done`, like `for await`. A source like a queue may block in `next()` after it is exhausted.
        if (
          isDone ||
          isIterableDone ||
          !(pendingPromisesCount < concurrency && promises.length < backpressure)
        ) {
          return
        }

        pendingPromisesCount++

        // Errors must be returned as a value instead of rejecting, otherwise a promise that
        // the consumer abandons after an earlier error becomes an unhandled rejection.
        const spawn = async (): Promise<IterableSlot<NewElement>> => {
          try {
            const { done, value } = await iterator.next()

            if (done) {
              isIterableDone = true
              pendingPromisesCount--
              return { done: true }
            }

            // Spawn if still below concurrency and backpressure limit
            trySpawn()

            const currentIndex = index++
            const element = await value

            // The consumer stopped iterating or a mapper threw while this input was pending, so drop it instead of doing work nobody will consume.
            if (isDone) {
              pendingPromisesCount--
              return { done: false, value: pMapSkip }
            }

            const returnValue = await mapper(element, currentIndex)

            pendingPromisesCount--

            if (returnValue === pMapSkip) {
              const index = promises.indexOf(promise)

              if (index > 0) {
                promises.splice(index, 1)
              }
            }

            // Spawn if still below backpressure limit and just dropped below concurrency limit
            trySpawn()

            return { done: false, value: returnValue }
          } catch (error) {
            pendingPromisesCount--
            isDone = true
            return { error }
          }
        }
        const promise = spawn()

        promises.push(promise)
      }

      trySpawn()

      try {
        while (promises.length > 0) {
          const result = await promises[0]

          promises.shift()

          if ('error' in result) {
            throw result.error
          }

          if (result.done) {
            return
          }

          // Spawn if just dropped below backpressure limit and below the concurrency limit
          trySpawn()

          if (result.value === pMapSkip) {
            continue
          }

          yield result.value as Exclude<NewElement, typeof pMapSkip>
        }
      } finally {
        // Stop pulling input once the consumer stops iterating, otherwise pending skipped mappers keep spawning work.
        isDone = true

        if (!isIterableDone) {
          void closeIterator(iterator)
        }
      }
    },
  }
}

// Close the source so it can release its resources, like `for await` does.
// Callers must not await this so a source that is blocked in `next()` cannot block them.
async function closeIterator(iterator: AnyIterator<unknown>): Promise<void> {
  try {
    await iterator.return?.()
  } catch {}
}
