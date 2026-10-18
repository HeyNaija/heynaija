// A real animated GIF made on the spot, so the upload test needs no binary fixture.

/** Packs LZW codes, least significant bit first, as GIF wants them. */
function pack(codes: number[], width: number): Buffer {
  const out: number[] = []
  let bits = 0
  let held = 0
  for (const code of codes) {
    held |= code << bits
    bits += width
    while (bits >= 8) {
      out.push(held & 0xff)
      held >>>= 8
      bits -= 8
    }
  }
  if (bits > 0) out.push(held & 0xff)
  return Buffer.from(out)
}

/**
 * A width x height GIF of two frames that swap their left and right halves, a
 * tenth of a second each, looping forever. The picture is not compressed (a clear
 * code after every second pixel keeps the codes three bits wide), which is valid
 * and large, but small pictures stay well under a hundred kilobytes.
 */
export function gif(width = 96, height = 64, left = [37, 129, 83], right = [234, 244, 238]): Buffer {
  const u16 = (n: number) => Buffer.from([n & 0xff, n >> 8])
  const palette = Buffer.from([...left, ...right, 0, 0, 0, 255, 255, 255]) // four colours
  const parts: Buffer[] = [
    Buffer.from('GIF89a', 'ascii'),
    u16(width),
    u16(height),
    Buffer.from([0x91, 0, 0]), // global palette of 4, no background
    palette,
    Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 3, 1, 0, 0, 0]), // loop forever
  ]
  for (const swapped of [false, true]) {
    const pixels: number[] = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) pixels.push((x < width / 2) !== swapped ? 0 : 1)
    }
    const CLEAR = 4
    const END = 5
    const codes: number[] = []
    for (let i = 0; i < pixels.length; i += 2) codes.push(CLEAR, ...pixels.slice(i, i + 2))
    codes.push(END)
    const data = pack(codes, 3)
    const blocks: Buffer[] = []
    for (let i = 0; i < data.length; i += 255) {
      const block = data.subarray(i, i + 255)
      blocks.push(Buffer.from([block.length]), block)
    }
    parts.push(
      Buffer.from([0x21, 0xf9, 4, 0, 10, 0, 0, 0]), // 100 ms, no transparency
      Buffer.from([0x2c, 0, 0, 0, 0]),
      u16(width),
      u16(height),
      Buffer.from([0, 2]), // no local palette; codes start at 2 bits
      ...blocks,
      Buffer.from([0]),
    )
  }
  parts.push(Buffer.from([0x3b]))
  return Buffer.concat(parts)
}
