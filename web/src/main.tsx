import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CHECKOUT_RETURN, inCheckoutFrame } from './lib/checkout'

if (inCheckoutFrame()) {
  // Paytm's callback redirected back to /app inside the checkout frame. Tell the app that
  // opened the checkout, and render nothing here. The message carries no data; the parent
  // asks the server what happened.
  window.parent.postMessage({ type: CHECKOUT_RETURN }, '*')
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
