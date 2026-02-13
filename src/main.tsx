import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/index.css'  // New BF3-style design system
import App from './App.tsx'

// Mount debug API before React render (DEV only)
if (import.meta.env.DEV) {
  import('./core/debug').then(({ createDebugAPI }) => {
    window.__debug = createDebugAPI();
    console.log('%c[Debug] window.__debug ready', 'color: #00d4aa; font-weight: bold');
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
