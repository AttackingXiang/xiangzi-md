import { memo, useEffect, useMemo, useState } from 'react'
import { BookOpen, Code2, Eye } from 'lucide-react'
import type { Tab } from '../types'
import type { TextCursorInfo } from './TextEditor'
import { t } from '../lib/i18n'
import { shortcutHint } from '../lib/shortcuts'
import { documentCursorBridge, type DocumentCursor } from '../lib/documentCursorBridge'

/** 文本文件的状态栏信息（Markdown 文档为 null） */
export interface TextStatus {
  info: TextCursorInfo | null
  language: string
}

interface Props {
  tab: Tab | null
  sourceMode: boolean
  focusMode: boolean
  typewriterMode: boolean
  autoSave: boolean
  readingMode: boolean
  showPath: boolean
  showReadingModeControl: boolean
  showSourceModeControl: boolean
  textStatus: TextStatus | null
  onToggleReading: () => void
  onToggleSource: () => void
}

function countWords(text: string): number {
  const cjk = (text.match(/[一-龥]/g) || []).length
  const words = (text.replace(/[一-龥]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length
  return cjk + words
}

const StatusBar = memo(function StatusBar({
  tab,
  sourceMode,
  focusMode,
  typewriterMode,
  autoSave,
  readingMode,
  showPath,
  showReadingModeControl,
  showSourceModeControl,
  textStatus,
  onToggleReading,
  onToggleSource,
}: Props): JSX.Element {
  const isText = textStatus !== null
  // App 每次击键都会重渲染，字数统计只在内容变化时重算；文本文件不做词数统计
  // （大 JSON/日志上这个正则不便宜），但字符数是白拿的。
  const content = tab?.content ?? ''
  const wordCount = useMemo(() => (isText ? 0 : countWords(content)), [content, isText])
  const charCount = content.length

  // Markdown 的光标位置走桥订阅，只让状态栏重渲染——见 documentCursorBridge。
  const [markdownCursor, setMarkdownCursor] = useState<DocumentCursor | null>(null)
  useEffect(
    () => (isText ? undefined : documentCursorBridge.subscribe(setMarkdownCursor)),
    [isText],
  )

  const cursor = textStatus?.info ?? null
  const position = isText
    ? cursor && {
        line: cursor.line,
        col: cursor.col,
        selections: cursor.selections,
        selected: cursor.selected,
      }
    : markdownCursor
  // 行列号/多光标/已选字符数：两个编辑器共用同一段展示。
  const positionInfo = position && (
    <>
      <span>
        {t('行')} {position.line}, {t('列')} {position.col}
      </span>
      {position.selections > 1 && (
        <span>
          {position.selections} {t('个光标')}
        </span>
      )}
      {position.selected > 0 && (
        <span>
          {t('已选')} {position.selected}
        </span>
      )}
    </>
  )

  return (
    <div className="statusbar">
      <span className="status-left">
        {showPath ? (tab ? (tab.path ?? t('未保存')) : t('就绪')) : ''}
      </span>
      <span className="status-right">
        {tab && isText && (
          <>
            {positionInfo}
            <span>{textStatus?.language}</span>
            {cursor && (
              <span>{cursor.eol === '\r\n' ? 'CRLF' : cursor.eol === '\r' ? 'CR' : 'LF'}</span>
            )}
            <span>
              {charCount} {t('字符')}
            </span>
            {autoSave && <span>{t('自动保存')}</span>}
            {tab.dirty && <span className="status-dirty">●&nbsp;{t('未保存')}</span>}
          </>
        )}
        {tab && !isText && (
          <>
            {positionInfo}
            <span>
              {wordCount} {t('字')}
            </span>
            <span>
              {charCount} {t('字符')}
            </span>
            {sourceMode && <span>{t('源码')}</span>}
            {typewriterMode && <span>{t('打字机模式')}</span>}
            {focusMode && <span>{t('专注模式')}</span>}
            {autoSave && <span>{t('自动保存')}</span>}
            {tab.dirty && <span className="status-dirty">●&nbsp;{t('未保存')}</span>}
          </>
        )}
        {(showReadingModeControl || showSourceModeControl) && (
          <span className="status-actions" aria-label={t('视图控制')}>
            {showReadingModeControl && (
              <button
                className={`status-action${readingMode ? ' active' : ''}`}
                type="button"
                title={`${t('阅读模式')}（${readingMode ? t('已开启') : t('已关闭')}）`}
                aria-pressed={readingMode}
                onClick={onToggleReading}
              >
                <BookOpen size={14} />
              </button>
            )}
            {showSourceModeControl && (
              <button
                className={`status-action${sourceMode ? ' active' : ''}`}
                type="button"
                title={`${t('源码模式')}（${sourceMode ? t('已开启') : t('已关闭')}）${shortcutHint('Mod+/')}`}
                aria-pressed={sourceMode}
                onClick={onToggleSource}
              >
                {sourceMode ? <Eye size={14} /> : <Code2 size={14} />}
              </button>
            )}
          </span>
        )}
      </span>
    </div>
  )
})

export default StatusBar
