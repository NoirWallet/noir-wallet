import { useEffect } from 'react'
import { LandingPage } from './pages/LandingPage'

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
      ? __WALLET_REPOSITORY_URL__
      : path === '/beta' || path === '/beta/versions'
        ? __WALLET_RELEASES_URL__
        : null

  useEffect(() => {
    if (redirectUrl) {
      window.location.replace(redirectUrl)
    }
  }, [redirectUrl])

  if (redirectUrl) {
    return null
  }

  return <LandingPage />
}
