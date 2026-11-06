import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Queue, Worker } from 'bullmq'
import type { Env } from '../../env.js'
import { ENV } from '../../tokens.js'
import { ChessGamesService } from './chess-games.service.js'
import { type AcceptedChallenge, type GameStarter, LICHESS } from './chess-tokens.js'
import { LichessError, type LichessApi } from './lichess.js'

const QUEUE = 'chess-games'
/** At most this many games watched at once by one API process. */
const WATCHERS_MAX = 200
/** Longest wait between tries to reach a game's stream again. */
const RETRY_MAX_MS = 30_000
/** After this many failed tries in a row the watcher gives up; the next API start tries again. */
const TRIES_MAX = 40

const connection = (env: Pick<Env, 'REDIS_URL'>) => ({ url: env.REDIS_URL, maxRetriesPerRequest: null })

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      done()
    })
  })

/**
 * Follows each game being played (docs/adr/0018): one BullMQ job per game, with
 * the game's id as the job's id, so exactly one process follows a game however
 * many API processes there are. The job holds the game's Board API stream open,
 * keeps the game's row up to date (which tells every page), and ends when Lichess
 * says the game is over. A dropped stream is opened again, backing off.
 */
@Injectable()
export class GameWatcher implements GameStarter, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ChessWatcher')
  private queue?: Queue
  private worker?: Worker
  private readonly running = new Map<string, AbortController>()

  constructor(
    @Inject(ENV) private readonly env: Pick<Env, 'REDIS_URL'>,
    @Inject(ChessGamesService) private readonly games: Pick<ChessGamesService, 'start' | 'streamToken' | 'applyState' | 'unfinished' | 'finish'>,
    @Inject(LICHESS) private readonly lichess: Pick<LichessApi, 'streamGame'>,
  ) {}

  async onApplicationBootstrap() {
    this.queue = new Queue(QUEUE, { connection: connection(this.env), defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } } })
    this.worker = new Worker(QUEUE, async (job) => this.follow(job.data.gameId as string), { connection: connection(this.env), concurrency: WATCHERS_MAX })
    this.worker.on('failed', (job, err) => this.logger.warn(`stopped following game ${job?.data?.gameId}: ${err.message}`))
    // Games still being played when the API last stopped.
    for (const gameId of await this.games.unfinished()) await this.watch(gameId)
  }

  async onModuleDestroy() {
    for (const controller of this.running.values()) controller.abort()
    await this.worker?.close()
    await this.queue?.close()
  }

  /** GameStarter: the game kept, the challenger told, the thread opened; then followed. */
  async begin(challenge: AcceptedChallenge, gameId: string, challengerColor: 'white' | 'black'): Promise<void> {
    await this.games.start(challenge, gameId, challengerColor)
    await this.watch(gameId)
  }

  /** Follows a game, unless a job already does. */
  async watch(gameId: string): Promise<void> {
    await this.queue?.add('follow', { gameId }, { jobId: gameId })
  }

  /** The job: read the game's stream until it is over, opening it again when it drops. */
  async follow(gameId: string, signal = this.signalFor(gameId)): Promise<void> {
    try {
      let tries = 0
      while (!signal.aborted) {
        const token = await this.games.streamToken(gameId)
        // Neither player has Lichess linked any more: nothing can follow it.
        if (!token) return
        try {
          for await (const event of this.lichess.streamGame(token, gameId, signal)) {
            tries = 0
            if (await this.games.applyState(gameId, event.type === 'gameFull' ? event.state : event)) return
          }
        } catch (err) {
          if (signal.aborted) return
          if (!(err instanceof LichessError)) throw err
          // A game Lichess no longer has (deleted, or never really made) is over.
          if (err.kind === 'rejected') {
            await this.games.finish(gameId)
            return
          }
          this.logger.warn(`game ${gameId}: ${err.message}`)
        }
        tries += 1
        if (tries >= TRIES_MAX) throw new Error(`could not reach the game's stream after ${tries} tries`)
        await sleep(Math.min(1000 * 2 ** Math.min(tries, 5), RETRY_MAX_MS), signal)
      }
    } finally {
      this.running.delete(gameId)
    }
  }

  private signalFor(gameId: string): AbortSignal {
    const controller = new AbortController()
    this.running.set(gameId, controller)
    return controller.signal
  }
}
