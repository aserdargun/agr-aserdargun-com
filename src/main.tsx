import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@aserdargun/lab-ui/styles.css'
import './agora.css'
import App from './ui/App'

const container = document.getElementById('root')
if (!container) throw new Error('The #root mount point is missing from index.html.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
