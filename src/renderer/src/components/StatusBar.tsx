import type { Tab } from '../types'
import { t } from '../lib/i18n'

interface Props {
  tab: Tab | null
  sourceMode: boolean
  autoSave: boolean
}

function countWords(text: string): number {
  const cjk = (text.match(/[一-龥]/g) || []).length
  const words = (text.replace(/[一-龥]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length
  return cjk + words
}

export default function StatusBar({ tab, sourceMode, autoSave }: Props): JSX.Element {
  return (
    <div className="statusbar">
      <span className="status-left">{tab ? (tab.path ?? t('未保存')) : t('就绪')}</span>
      <span className="status-right">
        {tab && (
          <>
            <span>
              {countWords(tab.content)} {t('字')}
            </span>
            <span>
              {tab.content.length} {t('字符')}
            </span>
            <span>{sourceMode ? t('源码') : t('所见即所得')}</span>
            {autoSave && <span>{t('自动保存')}</span>}
            {tab.dirty && <span className="status-dirty">●&nbsp;{t('未保存')}</span>}
          </>
        )}
      </span>
    </div>
  )
}
