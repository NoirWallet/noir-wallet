import { lstat, readdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const extensionDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = path.join(extensionDirectory, 'tests/e2e')
const screenshotDirectory = path.resolve(extensionDirectory, '../../e2e-output/screenshots')
const prune = process.argv.includes('--prune')
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--prune')

if (unknownArguments.length > 0) {
  throw new Error(`Unknown screenshot check arguments: ${unknownArguments.join(', ')}`)
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)))
    } else if (/\.(?:mjs|ts|tsx)$/.test(entry.name)) {
      files.push(entryPath)
    }
  }
  return files
}

function collectCaptureNames(source, fileName) {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  const captures = []

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'captureScreenshot'
    ) {
      const filename = node.arguments[1]
      if (!filename || !ts.isStringLiteralLike(filename)) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        throw new Error(
          `${path.relative(extensionDirectory, fileName)}:${position.line + 1} must use a literal screenshot filename`
        )
      }
      if (!/^[a-z0-9][a-z0-9.-]*\.png$/.test(filename.text)) {
        throw new Error(`Unsafe screenshot filename: ${filename.text}`)
      }
      captures.push(filename.text)
    }
    node.forEachChild(visit)
  }

  visit(sourceFile)
  return captures
}

const sourceFiles = await collectSourceFiles(sourceDirectory)
const catalog = new Map()
for (const fileName of sourceFiles) {
  const source = await readFile(fileName, 'utf8')
  for (const captureName of collectCaptureNames(source, fileName)) {
    const existing = catalog.get(captureName)
    if (existing) {
      throw new Error(
        `Duplicate screenshot filename ${captureName}: ${path.relative(extensionDirectory, existing)} and ${path.relative(extensionDirectory, fileName)}`
      )
    }
    catalog.set(captureName, fileName)
  }
}

const screenshotDirectoryStat = await lstat(screenshotDirectory).catch(error => {
  if (error?.code === 'ENOENT') return null
  throw error
})
if (!screenshotDirectoryStat?.isDirectory() || screenshotDirectoryStat.isSymbolicLink()) {
  throw new Error(`Screenshot directory is missing or unsafe: ${screenshotDirectory}`)
}

const screenshotEntries = await readdir(screenshotDirectory, { withFileTypes: true })
const generated = new Set()
for (const entry of screenshotEntries) {
  if (!entry.name.endsWith('.png')) continue
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`Screenshot artifact is not a regular file: ${entry.name}`)
  }
  generated.add(entry.name)
}

const stale = [...generated].filter(filename => !catalog.has(filename)).sort()
if (prune) {
  for (const filename of stale) {
    await unlink(path.join(screenshotDirectory, filename))
    generated.delete(filename)
  }
}

const missing = [...catalog.keys()].filter(filename => !generated.has(filename)).sort()
const remainingStale = prune ? [] : stale

if (remainingStale.length > 0 || missing.length > 0) {
  const details = [
    ...(remainingStale.length > 0
      ? [`Stale screenshots (${remainingStale.length}): ${remainingStale.join(', ')}`]
      : []),
    ...(missing.length > 0
      ? [`Missing screenshots (${missing.length}): ${missing.join(', ')}`]
      : [])
  ]
  throw new Error(details.join('\n'))
}

console.log(
  `${prune && stale.length > 0 ? `Pruned ${stale.length} stale screenshots; ` : ''}verified ${catalog.size} current screenshots`
)
