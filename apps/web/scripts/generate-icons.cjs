const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')

// Reuse Next's existing image runtime; no extra asset-generation dependencies.
const nextRequire = createRequire(require.resolve('next/package.json'))
const sharp = nextRequire('sharp')
const root = path.resolve(__dirname, '..')

async function main() {
  const source = await fs.readFile(path.join(root, 'public/brand/heynaija-mark.svg'))
  const render = (size) => sharp(source, { density: 192 }).resize(size, size).png().toBuffer()
  const outputs = [
    ['public/brand/heynaija-mark-preview.png', 128],
    ['app/icon.png', 512],
    ['app/apple-icon.png', 180],
    ['public/icons/icon-192.png', 192],
    ['public/icons/icon-512.png', 512],
  ]
  for (const [file, size] of outputs) {
    await fs.writeFile(path.join(root, file), await render(size))
  }

  // ICO directory followed by PNG frames for browser tabs at standard sizes.
  const sizes = [16, 32, 48]
  const frames = await Promise.all(sizes.map(render))
  const directory = Buffer.alloc(6 + 16 * sizes.length)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(sizes.length, 4)
  let offset = directory.length
  frames.forEach((frame, i) => {
    const entry = 6 + i * 16
    directory[entry] = sizes[i]
    directory[entry + 1] = sizes[i]
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(frame.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += frame.length
  })
  await fs.writeFile(path.join(root, 'app/favicon.ico'), Buffer.concat([directory, ...frames]))
  await writeBadge(source)
  await writeMaskable(source)
  console.log('Generated browser, Apple, installable-app, maskable and notification badge icons from heynaija-mark.svg.')
}

/**
 * Android draws a push notification's badge in the status bar from its alpha
 * channel alone, so the badge is the white letters without their green tile.
 */
async function writeBadge(source) {
  const letters = Buffer.from(source.toString().replace(/<rect[^>]*\/>/, ''))
  const badge = await sharp(letters, { density: 192 }).resize(96, 96).png().toBuffer()
  await fs.writeFile(path.join(root, 'public/icons/badge-96.png'), badge)
}

/**
 * Android crops an installed app's icon to its own shape (a circle, a squircle),
 * keeping only the middle 80% for certain. The tile's letters reach nearly to its
 * edges, so this one draws them smaller, on green to the very corners.
 */
async function writeMaskable(source) {
  const letters = Buffer.from(source.toString().replace(/<rect[^>]*\/>/, ''))
  const inner = Math.round(512 * 0.72)
  const art = await sharp(letters, { density: 192 }).resize(inner, inner).png().toBuffer()
  const icon = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#024822' } })
    .composite([{ input: art, gravity: 'centre' }])
    .png()
    .toBuffer()
  await fs.writeFile(path.join(root, 'public/icons/maskable-512.png'), icon)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
