import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { currentDesktopPlatform } from './lib/platform'
import { isBrowserPreview } from './platform'

document.body.classList.add(`is-${currentDesktopPlatform()}`)
if (isBrowserPreview) document.body.classList.add('is-browser-preview')

// Crepe/ProseMirror is an imperative editor with an expensive asynchronous
// lifecycle. React StrictMode intentionally mounts, destroys and mounts effects
// again in development, which makes every large document render twice.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
