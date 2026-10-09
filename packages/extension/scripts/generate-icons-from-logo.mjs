import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const svgPath = path.join(root, 'src/images/logo.svg')
const outDir = path.join(root, 'public/icons')

const svg = fs.readFileSync(svgPath, 'utf8')
for (const w of [16, 32, 48, 128]) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: w } })
  const png = resvg.render().asPng()
  fs.writeFileSync(path.join(outDir, `icon${w}.png`), png)
}
console.log('Wrote icon16/32/48/128.png from src/images/logo.svg')
