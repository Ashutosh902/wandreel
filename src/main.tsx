import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import {
  SHARED_INTENT_CLIENT_MESSAGE,
  SHARED_INTENT_RECEIVED_EVENT,
  isShareIntentMessage,
} from './pwa/shareTarget'

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true)
  },
})

if ('serviceWorker' in navigator) {
  let hasReloadedForUpdate = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasReloadedForUpdate) return
    hasReloadedForUpdate = true
    window.location.reload()
  })

  const recheckForUpdate = () => {
    void updateSW(false)
  }

  window.addEventListener('online', recheckForUpdate)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      recheckForUpdate()
    }
  })

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!isShareIntentMessage(event.data) || event.data.type !== SHARED_INTENT_CLIENT_MESSAGE) return
    if (import.meta.env.DEV) {
      console.debug('[share-target] app received service worker message')
    }
    window.dispatchEvent(new CustomEvent(SHARED_INTENT_RECEIVED_EVENT))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
