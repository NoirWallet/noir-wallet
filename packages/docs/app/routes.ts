import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('./routes/home.tsx'),
  route('api/search', './routes/search.ts'),
  route('sitemap.xml', './routes/sitemap.ts'),
  route('llms.txt', './routes/llms-index.ts'),
  route('llms-full.txt', './routes/llms-full.ts'),
  route('llms.mdx/*', './routes/llms-page.ts'),
  route('404', './routes/not-found.tsx'),
  route('*', './routes/docs.tsx')
] satisfies RouteConfig
