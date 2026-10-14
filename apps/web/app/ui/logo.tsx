import Image from 'next/image'
import Link from 'next/link'

/**
 * The HeyNaija wordmark. `size` is its rendered height in pixels.
 *
 * Both files are served as-is: run through the image optimiser the mark was
 * shrunk to the nearest "sizes" step and went soft on high-density screens. Each
 * is 900px wide, enough for a 3x display at the largest size we show.
 */
export function Logo({ size = 32 }: { size?: number }) {
  const style = { height: size * 1.5, width: 'auto' }
  return (
    <Link href="/" className="brand-link" aria-label="HeyNaija home">
      <Image
        src="/brand/heynaija-wordmark.webp"
        alt="HeyNaija"
        width={900}
        height={300}
        className="brand-wordmark only-light"
        style={style}
        unoptimized
        preload
      />
      {/* Pale lettering for the dark theme; CSS shows whichever matches. */}
      <Image
        src="/brand/heynaija-wordmark-dark.webp"
        alt=""
        aria-hidden="true"
        width={900}
        height={300}
        className="brand-wordmark only-dark"
        style={style}
        unoptimized
        loading="eager"
      />
    </Link>
  )
}
