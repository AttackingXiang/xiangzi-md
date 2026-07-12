export interface VirtualSearchHandler {
  find: (query: string) => void
  next: () => void
  prev: () => void
  replace: (query: string, replacement: string) => void
  replaceAll: (query: string, replacement: string) => void
  clear: () => void
}

let handler: VirtualSearchHandler | null = null

export const virtualSearchBridge = {
  set(next: VirtualSearchHandler | null): void {
    handler = next
  },
  get(): VirtualSearchHandler | null {
    return handler
  },
}
