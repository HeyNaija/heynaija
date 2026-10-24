/**
 * A value that is the same for every caller and may be up to `ttlMs` old, such as
 * a ranking. The first call waits for it. Once it is older than `ttlMs`, one
 * refresh runs in the background and callers keep getting the old value until it
 * lands, so nobody waits on the query after the first. A failed refresh leaves
 * the old value in place; the next call tries again.
 */
export class Refreshing<T> {
  private value: { data: T; expiresAt: number } | null = null
  private refresh: Promise<void> | null = null

  constructor(
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
  ) {}

  async get(): Promise<T> {
    const cached = this.value
    if (cached && cached.expiresAt > Date.now()) return cached.data
    this.refresh ??= this.load()
      .then((data) => {
        this.value = { data, expiresAt: Date.now() + this.ttlMs }
      })
      .finally(() => {
        this.refresh = null
      })
    if (!cached) {
      await this.refresh
      return this.value!.data
    }
    this.refresh.catch(() => {})
    return cached.data
  }
}
