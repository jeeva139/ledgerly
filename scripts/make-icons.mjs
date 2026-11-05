// Renders the Ledgerly mark to PNG sizes and a multi-size Windows .ico (offline, build-time only).
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svg = fs.readFileSync(path.join(root, 'assets', 'logo', 'ledgerly-mark.svg'), 'utf8')
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

fs.mkdirSync(path.join(root, 'build'), { recursive: true })
fs.mkdirSync(path.join(root, 'assets', 'icons'), { recursive: true })
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((s) => ({ s, png: render(s) }))
for (const { s, png } of pngs) fs.writeFileSync(path.join(root, 'assets', 'icons', `icon-${s}.png`), png)
fs.writeFileSync(path.join(root, 'build', 'icon.png'), render(512))
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), await pngToIco(pngs.map((p) => p.png)))
console.log('Icons written to build/ and assets/icons/')
