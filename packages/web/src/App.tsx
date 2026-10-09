import { useEffect } from 'react'
import { LandingPage } from './pages/LandingPage'

const REPOSITORY_URL = 'https://github.com/NoirWallet/noir-wallet'
const RELEASES_URL = `${REPOSITORY_URL}/releases`

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1)
  }
  return path
}

export default function App() {
  const path = normalizePath(window.location.pathname)
  const redirectUrl =
    path === '/github'
      ? REPOSITORY_URL
      : path === '/beta' || path === '/beta/versions'
        ? RELEASES_URL
        : null

  useEffect(() => {
    if (redirectUrl) window.location.replace(redirectUrl)
  }, [redirectUrl])

  if (redirectUrl) return null

  return <LandingPage />
}
