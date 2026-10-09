import type { Route } from './+types/docs'
import browserCollections from 'collections/browser'
import { useFumadocsLoader } from 'fumadocs-core/source/client'
import { GlassLayout } from 'fumadocs-ui/layouts/glass'
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover
} from 'fumadocs-ui/layouts/glass/page'
import { useMDXComponents } from '@/components/mdx'
import { baseOptions } from '@/lib/layout.shared'
import { getPageMarkdownUrl, source } from '@/lib/source'
import NotFoundPage from '@/routes/not-found'

export async function loader({ params }: Route.LoaderArgs) {
  const slugs = (params['*'] ?? '').split('/').filter(Boolean)
  const page = source.getPage(slugs)
  if (!page) throw new Response('Not found', { status: 404 })

  return {
    path: page.path,
    title: page.data.title,
    description: page.data.description,
    markdownUrl: getPageMarkdownUrl(page).url,
    pageTree: await source.serializePageTree(source.getPageTree())
  }
}

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.title ?? 'Documentation'} — Noir Wallet Docs` },
  ...(loaderData?.description ? [{ name: 'description', content: loaderData.description }] : [])
]

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: Mdx },
    {
      markdownUrl
    }: {
      markdownUrl: string
    }
  ) {
    return (
      <DocsPage toc={toc}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <div className="not-prose -mt-4 flex flex-row items-center gap-2 border-b pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover markdownUrl={markdownUrl} />
        </div>
        <DocsBody>
          <Mdx components={useMDXComponents()} />
        </DocsBody>
      </DocsPage>
    )
  }
})

export default function DocumentationPage({ loaderData }: Route.ComponentProps) {
  const { pageTree, markdownUrl } = useFumadocsLoader(loaderData)

  return (
    <GlassLayout {...baseOptions()} tree={pageTree} tabs={{ transform: tab => tab }}>
      {clientLoader.useContent(loaderData.path, {
        markdownUrl
      })}
    </GlassLayout>
  )
}

export function ErrorBoundary() {
  return <NotFoundPage />
}
