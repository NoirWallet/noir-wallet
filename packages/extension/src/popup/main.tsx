import '@/core/services/lending-sdk-init'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { isSidePanelSurface } from '@/config/extension-display'

if (isSidePanelSurface(window.location.search)) {
  document.documentElement.dataset.surface = 'side-panel'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
