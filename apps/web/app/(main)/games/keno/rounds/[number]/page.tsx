import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { LocalTime } from '@/app/ui/local-time'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getKenoRound, getViewer } from '@/lib/api'
import { RoundCheck } from '../../_components/round-check'

export const metadata: Metadata = { title: 'Check a Keno round', robots: { index: false } }

/** One round, and how anyone can check it was fair (docs/adr/0028, phase 4). */
export default function KenoRoundPage({ params }: PageProps<'/games/keno/rounds/[number]'>) {
  return (
    <div className="page-stack">
      <Suspense fallback={<PostsSkeleton />}>
        <Round params={params} />
      </Suspense>
    </div>
  )
}

async function Round({ params }: Pick<PageProps<'/games/keno/rounds/[number]'>, 'params'>) {
  const [{ number: raw }, viewer] = await Promise.all([params, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  if (!/^\d{1,9}$/.test(raw)) notFound()
  const round = await getKenoRound(Number(raw))
  if (!round) notFound()
  const drawn = round.seed && round.numbers
  const command = drawn
    ? `node -e 'const c=require("crypto"),s=process.argv[1],r=+process.argv[2],d=[];console.log(c.createHash("sha256").update(s).digest("hex"));for(let k=0;d.length<20;k++){const b=c.createHmac("sha256",s).update(r+":"+k).digest();for(let i=0;i<32&&d.length<20;i+=4){const v=b.readUInt32BE(i);if(v>=4294967280)continue;const n=v%80+1;if(!d.includes(n))d.push(n)}}console.log(d.join(" "))' ${round.seed} ${round.number}`
    : null
  return (
    <>
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/keno" className="hover:underline">Keno</Link> ·{' '}
          <Link href="/games/keno/rounds" className="hover:underline">Past draws</Link>
        </p>
        <h1 className="page-title">Round #{round.number}</h1>
        <p className="page-description">
          {drawn ? (
            <>
              Drawn <LocalTime at={round.drawnAt!} as="posted" />
              {round.late ? ', late: the draw was missed at its time and made as soon as it could be' : ''}.
            </>
          ) : (
            <>
              Draws <LocalTime at={round.drawsAt} as="posted" />.
            </>
          )}
        </p>
      </header>

      {drawn ? (
        <section className="content-panel" aria-labelledby="round-numbers">
          <h2 id="round-numbers" className="section-title">The numbers, in the order drawn</h2>
          <ol className="keno-drawn">
            {round.numbers!.map((n) => (
              <li key={n} className="keno-ball" data-shown="true">{n}</li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="content-panel" aria-labelledby="round-fair">
        <h2 id="round-fair" className="section-title">Check it was fair</h2>
        <dl className="keno-proof">
          <dt>Fairness hash, published before any ticket for this round</dt>
          <dd><code>{round.seedHash}</code></dd>
          <dt>Seed</dt>
          <dd>{round.seed ? <code>{round.seed}</code> : 'The seed is revealed after the draw.'}</dd>
        </dl>
        {drawn ? <RoundCheck round={{ number: round.number, seedHash: round.seedHash, seed: round.seed!, numbers: round.numbers! }} /> : null}
        <h3 className="mt-4 text-sm font-semibold">How it works</h3>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Before a round takes tickets, HeyNaija picks a secret seed at random and publishes its SHA-256 hash above. The
            hash fixes the seed: no other seed gives it, so the seed cannot be swapped once tickets are in.
          </li>
          <li>
            At the draw, the seed is revealed. The 20 numbers come from the seed and the round number alone: for 0, 1, 2 …
            in turn, HMAC-SHA256 with the seed as key and “{round.number}:0”, “{round.number}:1” … as message, read as
            32-bit numbers; each below 4,294,967,280 gives (number mod 80) + 1, skipping repeats, until there are 20.
          </li>
          <li>Nobody can choose the numbers after seeing the tickets, and anyone can work them out again.</li>
        </ol>
        {command ? (
          <>
            <p className="mt-3 text-sm text-muted">Or check it yourself with Node.js: it prints the hash, then the numbers.</p>
            <pre className="keno-command"><code>{command}</code></pre>
          </>
        ) : null}
      </section>
    </>
  )
}
