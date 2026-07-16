import type { Extension } from '@codemirror/state'
import katex from 'katex'
import { renderMermaidForExport, renderMermaidForPreview } from '../../lib/mermaidPreview'
import { markdownCodeBlockPreview } from './codeBlockPreview'
import { markdownImagePreview } from './imagePreview'
import { markdownLivePreview } from './livePreview'
import { markdownMathPreview } from './mathPreview'
import { markdownMermaidPreview } from './mermaidPreview'
import { markdownTablePreview } from './tablePreview'

export interface MarkdownPreviewExtensionOptions {
  enabled?: boolean
  resolveImageSrc: (src: string) => Promise<string | null> | string | null
  allowRemoteImages: boolean
  imageMaxWidth: number
  codeBlockLineWrapping: boolean
  previewThemeVersion: string
}

/**
 * The one visual Markdown extension factory shared by the interactive editor
 * and export renderers. Export must never grow its own Markdown parser/style
 * implementation again: a visual change belongs here and reaches both paths.
 */
export function createMarkdownPreviewExtensions(
  options: MarkdownPreviewExtensionOptions,
): Extension[] {
  if (options.enabled === false) return []
  return [
    markdownLivePreview(),
    markdownCodeBlockPreview({
      copyLabel: '复制',
      copiedLabel: '已复制',
      lineWrapping: options.codeBlockLineWrapping,
    }),
    markdownImagePreview({
      resolveSrc: options.resolveImageSrc,
      allowRemote: options.allowRemoteImages,
      maxWidth: options.imageMaxWidth,
    }),
    markdownTablePreview(),
    markdownMathPreview({
      render: (source, container, displayMode) =>
        katex.render(source, container, { displayMode, throwOnError: true }),
      errorLabel: '公式语法有误',
    }),
    markdownMermaidPreview({
      render: renderMermaidForPreview,
      renderForCopy: renderMermaidForExport,
      version: options.previewThemeVersion,
      errorLabel: '图表语法有误',
    }),
  ]
}
