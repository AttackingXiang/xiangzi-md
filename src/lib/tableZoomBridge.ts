type RequestHandler = (html: string) => void

let handler: RequestHandler | null = null

/** Publishes a rendered table snapshot from the CM6 widget into the React modal layer. */
export const tableZoomBridge = {
  setHandler(next: RequestHandler | null): void {
    handler = next
  },
  request(html: string): void {
    handler?.(html)
  },
}
