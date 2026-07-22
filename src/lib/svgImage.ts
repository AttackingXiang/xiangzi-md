import { fitImageDimensions } from './imageDimensions'

const MAX_SVG_IMAGE_PIXELS = 16_000_000

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded = ''] = dataUrl.split(',', 2)
  const mime = /data:([^;]+)/.exec(header)?.[1] || 'image/png'
  const binary = atob(encoded)
  const data = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index)
  return new Blob([data], { type: mime })
}

/** Rasterize SVG markup without foreignObject content into a bounded PNG. */
export async function svgMarkupToPng(
  svgMarkup: string,
  backgroundColor: string,
  scale = 2,
): Promise<Blob | null> {
  const holder = document.createElement('div')
  holder.innerHTML = svgMarkup
  const svg = holder.querySelector('svg')
  if (!svg) return null
  const viewBox = svg.viewBox.baseVal
  const width = Math.max(1, Math.round(viewBox?.width || Number(svg.getAttribute('width')) || 800))
  const height = Math.max(
    1,
    Math.round(viewBox?.height || Number(svg.getAttribute('height')) || 600),
  )
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.style.maxWidth = ''

  const serialized = new XMLSerializer().serializeToString(svg)
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  let canvas: HTMLCanvasElement | undefined
  try {
    const image = new Image()
    image.decoding = 'async'
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => reject(new Error('图表转换失败')), { once: true })
        image.src = url
      }),
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('图表图片解码超时')), 5000)
      }),
    ])
    const dimensions = fitImageDimensions(width * scale, height * scale, MAX_SVG_IMAGE_PIXELS)
    canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片画布')
    context.fillStyle = backgroundColor
    context.fillRect(0, 0, dimensions.width, dimensions.height)
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    return dataUrlToBlob(canvas.toDataURL('image/png'))
  } finally {
    if (canvas) {
      canvas.width = 1
      canvas.height = 1
    }
    URL.revokeObjectURL(url)
  }
}
