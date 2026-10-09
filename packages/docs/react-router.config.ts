import type { Config } from '@react-router/dev/config'
import { glob } from 'node:fs/promises'
import { createGetUrl, getSlugs } from 'fumadocs-core/source'

const getUrl = createGetUrl('/')

export default {
  ssr: false,
  async prerender({ getStaticPaths }) {
    const paths = new Set(getStaticPaths())

    for await (const entry of glob('**/*.mdx', { cwd: 'content/docs' })) {
      const slugs = getSlugs(entry)
      paths.add(getUrl(slugs))
      paths.add(`/llms.mdx/${[...slugs, 'content.md'].join('/')}`)
    }

    return [...paths]
  }
} satisfies Config
