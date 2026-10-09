export class KeyedTaskCoordinator<T> {
  private readonly tasks = new Map<string, Promise<T>>()

  get size(): number {
    return this.tasks.size
  }

  has(key: string): boolean {
    return this.tasks.has(key)
  }

  keys(): IterableIterator<string> {
    return this.tasks.keys()
  }

  run(key: string, task: () => Promise<T>): Promise<T> {
    const active = this.tasks.get(key)
    if (active) return active

    let promise: Promise<T>
    promise = Promise.resolve()
      .then(task)
      .finally(() => {
        if (this.tasks.get(key) === promise) {
          this.tasks.delete(key)
        }
      })
    this.tasks.set(key, promise)
    return promise
  }
}
