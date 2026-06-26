import { protocol, net } from 'electron'
import { pathToFileURL } from 'url'

/**
 * 自定义协议：用于在渲染层安全地加载本地图片等资源。
 * URL 形如  xmd://local/<encodeURIComponent(绝对路径)>
 */
export const XMD_SCHEME = 'xmd'

/** 必须在 app ready 之前调用 */
export function registerXmdPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: XMD_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true
      }
    }
  ])
}

/** 在 app ready 之后调用 */
export function handleXmdProtocol(): void {
  protocol.handle(XMD_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const encoded = url.pathname.replace(/^\/+/, '')
      const filePath = decodeURIComponent(encoded)
      return await net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}

/** 把绝对路径构造成 xmd:// 资源 URL */
export function toXmdURL(absPath: string): string {
  return `${XMD_SCHEME}://local/${encodeURIComponent(absPath)}`
}
