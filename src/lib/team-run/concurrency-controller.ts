export class ConcurrencyController {
  private running: number = 0
  private queue: Array<() => Promise<void>> = []

  constructor(private maxConcurrency: number = 3) {}

  async execute<T>(task: () => Promise<T>): Promise<T> {
    while (this.running >= this.maxConcurrency) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    this.running++

    try {
      return await task()
    } finally {
      this.running--
    }
  }

  getRunningCount(): number {
    return this.running
  }
}
