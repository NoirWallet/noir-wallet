import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'

const outputDirectory = new URL('../build/client/', import.meta.url)
const outputPath = outputDirectory.pathname

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)))
    } else {
      files.push(path)
    }
  }

  return files
}

function normalizePath(path) {
  return relative(outputPath, path).split(sep).join('/')
}

function outputRepresentsRoute(files, route) {
  const routePath = route.replace(/^\/|\/$/g, '')
  if (!routePath) return files.has('index.html')

  return (
    files.has(`${routePath}.html`) || files.has(`${routePath}/index.html`) || files.has(routePath)
  )
}

const absoluteFiles = await listFiles(outputPath)
const files = new Set(absoluteFiles.map(normalizePath))
const requiredRoutes = [
  '/',
  '/get-started',
  '/noir-sdk-integration',
  '/noir-wallet-v1-user-guide',
  '/faq',
  '/privacy-policy',
  '/wallet-guide',
  '/developers',
  '/sitemap.xml',
  '/llms.txt',
  '/llms-full.txt',
  '/get-started.md',
  '/noir-sdk-integration.md',
  '/404.html'
]

const missingRoutes = requiredRoutes.filter(route => !outputRepresentsRoute(files, route))

if (missingRoutes.length > 0) {
  throw new Error(`Static output is missing routes: ${missingRoutes.join(', ')}`)
}

const htmlFiles = absoluteFiles.filter(file => extname(file) === '.html')
const html = (await Promise.all(htmlFiles.map(file => readFile(file, 'utf8')))).join('\n')

if (!html.includes('Noir Wallet')) {
  throw new Error('Static HTML does not contain the Noir Wallet brand')
}

if (html.includes('layout-harness') || html.includes('e2e-dist')) {
  throw new Error('Production documentation output contains test harness code')
}

const internalLinks = new Set([...html.matchAll(/href="(\/[^"#?]*)/g)].map(match => match[1]))
const ignoredPrefixes = ['/assets/', '/api/']
const brokenLinks = [...internalLinks].filter(link => {
  if (ignoredPrefixes.some(prefix => link.startsWith(prefix))) return false
  return !outputRepresentsRoute(files, link)
})

if (brokenLinks.length > 0) {
  throw new Error(`Static HTML contains unresolved internal links: ${brokenLinks.join(', ')}`)
}

console.log(
  `Verified ${requiredRoutes.length} required routes and ${internalLinks.size} internal links.`
)
