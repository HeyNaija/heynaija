// The video trial (docs/video-trial.md): real phone clips through the HLS encoder the
// worker will use, on the server we would rent, with every number the plan needs.
// Usage, in the video-worker image:
//   node dist/cli/video-trial.js <clips folder> [--out <folder>] [--upload] [--max-seconds 180]
//   node dist/cli/video-trial.js --clean <run id>
// For each clip: probe it, send the original to Arachnid Shield (when its login is set),
// encode it to HLS, and time it all. --upload puts the results and a test page in the
// media bucket under trial/<run id>/, to play on phones; --clean deletes them again.
// A clip Shield matches is stopped there: never encoded, never uploaded.

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { ArachnidShieldScanner } from '../media/arachnid-shield.js'
import { HLS_PIECE_SECONDS } from '../video/hls.js'
import { canToneMap, CLIP_TYPES, type ClipResult, clean, resultsTable, runClip, slugOf, upload } from '../video/trial.js'

const USAGE = `usage:
  video-trial <clips folder> [--out <folder>] [--upload] [--max-seconds 180]
  video-trial --clean <run id>`

const { values, positionals } = parseArgs({
  options: { out: { type: 'string' }, upload: { type: 'boolean' }, clean: { type: 'string' }, 'max-seconds': { type: 'string' } },
  allowPositionals: true,
})

async function main(): Promise<void> {
  if (values.clean) {
    console.log(`removed ${await clean(values.clean)} files under trial/${values.clean}/`)
    return
  }
  const [clipsDir] = positionals
  if (!clipsDir) throw new Error(USAGE)
  const outDir = values.out ?? 'trial-out'
  await mkdir(outDir, { recursive: true })

  const { ARACHNID_SHIELD_USERNAME: user, ARACHNID_SHIELD_PASSWORD: pass, ARACHNID_SHIELD_URL: shieldUrl } = process.env
  const shield = user && pass ? new ArachnidShieldScanner(user, pass, shieldUrl || undefined) : null
  if (!shield) console.log('Arachnid Shield login not set: clips are encoded without the check (set it to time Shield too).')
  if (!(await canToneMap())) console.log('This ffmpeg has no zscale filter, so HDR clips will fail. The video-worker image has it.')
  // The agreed limit is 3 minutes; the encoder reads no further than this, whatever a file claims.
  const maxSeconds = Number(values['max-seconds'] ?? 180)

  const runId = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').toLowerCase()
  const taken = new Set<string>()
  const clips = (await readdir(clipsDir)).filter((f) => CLIP_TYPES[extname(f).toLowerCase()]).sort()
  if (clips.length === 0) throw new Error(`no .mp4, .mov, .m4v, .webm or .mkv files in ${clipsDir}`)
  const results: ClipResult[] = []
  for (const file of clips) {
    console.log(`${file}: working…`)
    const r = await runClip(join(clipsDir, file), slugOf(file, taken), outDir, shield, maxSeconds)
    results.push(r)
    console.log(r.error ? `${file}: ${r.error}` : `${file}: done in ${r.encode!.wallS.toFixed(1)} s`)
  }

  const table = resultsTable(results)
  await writeFile(join(outDir, 'results.md'), `# Video trial ${runId}\n\nPieces of ${HLS_PIECE_SECONDS} s; at most ${maxSeconds} s read per clip.\n\n${table}\n`)
  await writeFile(join(outDir, 'results.json'), JSON.stringify({ runId, results }, null, 2))
  console.log(`\n${table}\n\nSaved in ${join(outDir, 'results.md')} and results.json.`)
  if (values.upload) {
    const url = await upload(runId, outDir, results)
    console.log(`\nTest page: ${url}\nOpen it on the phones. When done: node dist/cli/video-trial.js --clean ${runId}`)
  }
}

main().catch((err) => {
  console.error((err as Error).message)
  process.exit(1)
})
