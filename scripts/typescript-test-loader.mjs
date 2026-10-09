import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(path.resolve('package.json'))
const ts = require('typescript')
const sourceDirectory = pathToFileURL(path.resolve('src') + path.sep)

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'typescript') {
    return nextResolve(require.resolve('typescript'), context)
  }
  const candidate = specifier.startsWith('@/')
    ? new URL(specifier.slice(2), sourceDirectory)
    : (specifier.startsWith('./') || specifier.startsWith('../')) &&
        context.parentURL?.startsWith('file:')
      ? new URL(specifier, context.parentURL)
      : null
  if (candidate) {
    for (const suffix of ['', '.ts', '.tsx', '.js', '/index.ts', '/index.js']) {
      const url = new URL(candidate.href + suffix)
      try {
        if ((await stat(url)).isFile()) return { url: url.href, shortCircuit: true }
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
      }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && /\.tsx?$/.test(new URL(url).pathname)) {
    const source = await readFile(new URL(url), 'utf8')
    const result = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        inlineSourceMap: true,
        inlineSources: true
      }
    })
    return { format: 'module', source: result.outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
