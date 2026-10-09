import { source, getLLMText } from '@/lib/source'

export async function loader({ params }: { params: Record<string, string | undefined> }) {
  const path = params['*'] ?? ''
  const slugs = path
    .replace(/\/content\.md$/, '')
    .split('/')
    .filter(Boolean)
  const page = source.getPage(slugs)

  if (!page) {
    return new Response('Not found', { status: 404 })
  }

  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8'
    }
  })
}
