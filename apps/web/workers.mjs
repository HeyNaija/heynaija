// Runs WEB_WORKERS copies of Next.js's standalone server on one port, so page
// rendering can use more than one CPU core. Rendering is the web app's bottleneck:
// one `next start` process tops out on one core (docs/loadtest.md, item 6). The
// copies share nothing but the port; the web app keeps no state of its own.
//
// The Docker image runs this instead of server.js (Dockerfile, `web` target).
// With WEB_WORKERS unset or 1 it is server.js and nothing else.
import cluster from 'node:cluster'

const workers = Number.parseInt(process.env.WEB_WORKERS ?? '1', 10)
if (!Number.isInteger(workers) || workers < 1) throw new Error(`WEB_WORKERS must be a positive integer, got ${process.env.WEB_WORKERS}`)

// A worker that keeps dying is a broken release, not a fluke: give up, and let
// Docker's restart policy (and the deploy's health check) deal with it.
const MAX_RESTARTS = 10
const RESTART_WINDOW_MS = 60_000

if (workers === 1 || !cluster.isPrimary) {
  await import('./server.js')
} else {
  let stopping = false
  let restarts = []

  for (let i = 0; i < workers; i++) cluster.fork()

  cluster.on('exit', (worker, code, signal) => {
    if (stopping) {
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0)
      return
    }
    const now = Date.now()
    restarts = [...restarts.filter((at) => now - at < RESTART_WINDOW_MS), now]
    if (restarts.length > MAX_RESTARTS) {
      console.error(`web worker ${worker.process.pid} exited (${signal ?? code}); ${MAX_RESTARTS} restarts in a minute, giving up`)
      process.exit(1)
    }
    console.error(`web worker ${worker.process.pid} exited (${signal ?? code}); starting another`)
    cluster.fork()
  })

  // `docker stop` signals this process only. Each worker finishes the requests it
  // has (Next.js handles SIGTERM that way) and exits; then so does this one.
  const stop = (signal) => {
    if (stopping) return
    stopping = true
    for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill(signal)
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
}
