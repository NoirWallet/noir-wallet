import { readdir } from 'node:fs/promises'

const directory = new URL('../src/popup/i18n/', import.meta.url)
const files = (await readdir(directory)).filter(file => file.endsWith('-messages.ts')).sort()
const placeholders = text =>
  [...new Set(Array.from(text.matchAll(/\{(\w+)\}/g), match => match[1]))].sort().join(',')
let messageCount = 0

for (const file of files) {
  const exports = await import(new URL(file, directory).href)
  const catalogs = Object.entries(exports).filter(([name]) => name.endsWith('Messages'))
  if (!catalogs.length) throw new Error(`${file} has no message catalogs`)
  for (const [catalogName, messages] of catalogs) {
    for (const [key, translations] of Object.entries(messages)) {
      if (
        !Array.isArray(translations) ||
        translations.length !== 3 ||
        translations.some(text => typeof text !== 'string' || !text.trim())
      ) {
        throw new Error(`${catalogName}.${key} must have three nonempty translations`)
      }
      const expected = placeholders(translations[0])
      if (translations.some(text => placeholders(text) !== expected)) {
        throw new Error(`${catalogName}.${key} has inconsistent translation placeholders`)
      }
      messageCount += 1
    }
  }
}

if (!messageCount) throw new Error('No UI translations were validated')
console.log(`Verified ${messageCount} UI messages in ${files.length} catalog files.`)
