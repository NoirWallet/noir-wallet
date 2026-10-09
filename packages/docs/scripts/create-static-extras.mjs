import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const outputDirectory = fileURLToPath(new URL('../build/client/', import.meta.url))
const markdownDirectory = join(outputDirectory, 'llms.mdx')

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

const markdownFiles = (await listFiles(markdownDirectory)).filter(file =>
  file.endsWith(`${sep}content.md`)
)

for (const source of markdownFiles) {
  const route = relative(markdownDirectory, dirname(source))
  const destination = join(outputDirectory, `${route}.md`)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
}

await copyFile(join(outputDirectory, '404', 'index.html'), join(outputDirectory, '404.html'))

console.log(`Generated ${markdownFiles.length} page Markdown files and 404.html.`)
