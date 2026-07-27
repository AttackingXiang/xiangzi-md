import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const host = process.env.TAURI_DEV_HOST

function katexWoff2Only(): Plugin {
  return {
    name: 'katex-woff2-only',
    enforce: 'pre',
    transform(css, id) {
      if (!/node_modules\/katex\/dist\/katex(?:\.min)?\.css$/.test(id)) return undefined

      return css.replace(/src:([^;}]+)/g, (declaration) => {
        const woff2Source = declaration
          .slice(4)
          .split(',')
          .find((source) => /format\(\s*["']?woff2["']?\s*\)/i.test(source))

        return woff2Source ? `src:${woff2Source}` : declaration
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [katexWoff2Only(), react()],

  build: {
    // Mermaid's optional architecture parser is a lazy 663 KiB chunk but only
    // 143 KiB compressed. Keep the warning useful for eagerly loaded code
    // without flagging that isolated on-demand parser.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Keep the application shell small and cache stable third-party
        // runtimes separately. Mermaid loads many diagram parsers lazily; its
        // language-server and parser dependencies also need their own chunks
        // or one uncommon diagram type produces a 600+ KiB payload warning.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules\/(?:react|react-dom|scheduler)\//.test(id)) return 'vendor-react'
          if (
            /node_modules\/@codemirror\/(?:state|view|language|commands|search|autocomplete)\//.test(
              id,
            ) ||
            /node_modules\/@lezer\/(?:common|highlight|lr)\//.test(id)
          ) {
            return 'vendor-editor-core'
          }
          if (id.includes('node_modules/@tauri-apps/')) return 'vendor-tauri'
          if (id.includes('node_modules/lucide-react/')) return 'vendor-icons'
          if (id.includes('vscode-language') || id.includes('vscode-jsonrpc')) {
            return 'vendor-vscode-languageserver'
          }
          if (id.includes('node_modules/chevrotain/')) return 'vendor-chevrotain'
          return undefined
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}))
