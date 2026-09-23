import { describe, expect, it } from 'vitest'
import { pMap, pMapSkip } from '../lib/pMap'

function timeSpan(): () => number {
  const start = performance.now()
  return () => performance.now() - start
}

function assertInRange(value: number, { start = 0, end }: { start?: number; end: number }) {
  expect(value).toBeGreaterThanOrEqual(start)
  expect(value).toBeLessThanOrEqual(end)
}

function generateSkipPerformanceData(length: number) {
  const data = []
  for (let index = 0; index < length; index++) {
    data.push(pMapSkip)
  }

  return data
}

describe('pMap performance', () => {
  it('multiple pMapSkips - algorithmic complexity', async () => {
    const testData = [
      generateSkipPerformanceData(1000),
      generateSkipPerformanceData(10_000),
      generateSkipPerformanceData(100_000),
    ]
    const testDurationsMS: number[] = []

    for (const data of testData) {
      const end = timeSpan()
      await pMap(data, async (value) => value)
      testDurationsMS.push(end())
    }

    for (let index = 0; index < testDurationsMS.length - 1; index++) {
      const smallerDuration = testDurationsMS[index]!
      const longerDuration = testDurationsMS[index + 1]!

      // Catches a regression that makes `pMapSkip` handling O(n^2) in the number of skipped items.
      // The bounds are loose because timings fluctuate.
      assertInRange(longerDuration, { start: 1.2 * smallerDuration, end: 15 * smallerDuration })
    }
  })
})
