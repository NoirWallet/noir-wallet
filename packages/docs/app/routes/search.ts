import { createFromSource } from 'fumadocs-core/search/server'
import { source } from '@/lib/source'

const server = createFromSource(source, {
  language: 'english'
})

export function loader() {
  return server.staticGET()
}
