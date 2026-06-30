export interface AsyncTaskQueue {
  run<T>(task: () => Promise<T>): Promise<T>
}

export function createTaskQueue(concurrency: number): AsyncTaskQueue {
  const limit = Math.max(1, Math.floor(concurrency))
  const waiting: Array<() => void> = []
  let active = 0

  const release = (): void => {
    active -= 1
    waiting.shift()?.()
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active >= limit) {
        await new Promise<void>((resolve) => waiting.push(resolve))
      }
      active += 1
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}

export async function mapWithConcurrencyLimit<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(concurrency)))
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
