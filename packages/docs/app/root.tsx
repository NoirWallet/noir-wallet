import type { LinksFunction } from 'react-router'
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'
import { RootProvider } from 'fumadocs-ui/provider/react-router'
import { SearchDialog } from '@/components/search'
import styles from '@/styles.css?url'
import noirWalletLogo from '../../extension/public/icons/icon128.png?url'

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: styles },
  { rel: 'icon', type: 'image/png', href: noirWalletLogo }
]

export default function Root() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#12121c" />
        <Meta />
        <Links />
      </head>
      <body>
        <RootProvider
          search={{ SearchDialog }}
          theme={{
            defaultTheme: 'dark',
            enableSystem: true,
            storageKey: 'noir-docs-theme'
          }}
        >
          <Outlet />
        </RootProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}
