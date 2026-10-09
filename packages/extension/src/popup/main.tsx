import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { initializeRuntimeNetwork } from '@/lib/runtime-network'

if (new URLSearchParams(window.location.search).get('surface') === 'side-panel') {
  document.documentElement.dataset.surface = 'side-panel'
}

async function bootstrap(): Promise<void> {
  await initializeRuntimeNetwork()
  await import('@/core/services/lending-sdk-init')
  const { default: App } = await import('./App')
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap().catch(error => {
  console.error('[Popup] Network initialization failed:', error)
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center text-foreground">
      <div>
        <h1 className="text-lg font-semibold">Wallet unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Noir Wallet could not load its network settings. Close and reopen the wallet to try again.
        </p>
      </div>
    </main>
  )
})
