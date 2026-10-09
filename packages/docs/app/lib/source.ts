import { docs } from 'collections/server'
import { loader } from 'fumadocs-core/source'
import { createElement } from 'react'
import { icons } from 'lucide-react'

export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource(),
  icon(icon) {
    if (!icon || !(icon in icons)) return
    return createElement(icons[icon as keyof typeof icons])
  }
})

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  return {
    url: `${page.url}.md`
  }
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed')

  return `# ${page.data.title}
URL: https://docs.zknoir.com${page.url}

${page.data.description ?? ''}

${processed}`
}
