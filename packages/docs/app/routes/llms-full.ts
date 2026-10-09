import { source, getLLMText } from '@/lib/source'

export async function loader() {
  const pages = source.getPages()
  const content = await Promise.all(pages.map(getLLMText))

  return new Response(content.join('\n\n---\n\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  })
}
