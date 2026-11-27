/**
 * Runs `load`, and once more if it fails: a chunk fetch on a phone often fails once and
 * then works. Two failures reject with the first, which names what went wrong.
 */
export function retryOnce<T>(load: () => Promise<T>): Promise<T> {
  return load().catch((first: unknown) =>
    load().catch(() => {
      throw first
    }),
  )
}
