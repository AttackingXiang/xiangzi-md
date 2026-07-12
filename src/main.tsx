import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { currentDesktopPlatform } from './lib/platform'

document.body.classList.add(`is-${currentDesktopPlatform()}`)

// Crepe/ProseMirror is an imperative editor with an expensive asynchronous
// lifecycle. React StrictMode intentionally mounts, destroys and mounts effects
// again in development, which makes every large document render twice.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
