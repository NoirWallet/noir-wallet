import type { MetaFunction } from 'react-router'
import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { DefaultNotFound } from 'fumadocs-ui/layouts/home/not-found'
import { baseOptions } from '@/lib/layout.shared'

export const meta: MetaFunction = () => [
  { title: 'Page not found — Noir Wallet Docs' },
  { name: 'robots', content: 'noindex' }
]

export default function NotFoundPage() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="grid min-h-[calc(100vh-3.5rem)] place-items-center p-6">
        <DefaultNotFound />
      </main>
    </HomeLayout>
  )
}
