import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'

const directory = path.resolve('tests')
const files = readdirSync(directory)
  .filter(name => /\.test\.(mjs|js|ts)$/.test(name))
  .sort()
  .map(name => path.join(directory, name))

if (files.length === 0) throw new Error('No core tests found')

const result = spawnSync(
  process.execPath,
  [
    '--import',
    new URL('./register-test-loader.mjs', import.meta.url).href,
    '--test',
    ...process.argv.slice(2),
    ...files
  ],
  { stdio: 'inherit' }
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
