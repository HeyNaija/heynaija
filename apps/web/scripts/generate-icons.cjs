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
  console.log('Generated browser, Apple, and installable-app icons from heynaija-mark.svg.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
