import { source } from '@/lib/source'

const siteUrl = 'https://docs.zknoir.com'

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function loader() {
  const paths = ['/', ...source.getPages().map(page => page.url)]
  const urls = [...new Set(paths)]
    .map(path => `<url><loc>${escapeXml(`${siteUrl}${path}`)}</loc></url>`)
    .join('')

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8'
      }
    }
  )
}
