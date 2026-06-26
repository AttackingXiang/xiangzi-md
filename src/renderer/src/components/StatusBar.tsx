import type { Tab } from '../types'

interface Props {
  tab: Tab | null
  sourceMode: boolean
}

function countWords(text: string): number {
  // 中文按字符计，英文按词计
  const cjk = (text.match(/[一-龥]/g) || []).length
  const words = (text.replace(/[一-龥]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length
  return cjk + words
}

export default function StatusBar({ tab, sourceMode }: Props): JSX.Element {
  return (
    <div className="statusbar">
      <span className="status-left">{tab ? tab.path ?? '未保存' : '就绪'}</span>
      <span className="status-right">
        {tab && (
          <>
            <span>{countWords(tab.content)} 字</span>
            <span>{tab.content.length} 字符</span>
            <span>{sourceMode ? '源码' : '所见即所得'}</span>
            {tab.dirty && <span className="status-dirty">未保存</span>}
          </>
        )}
      </span>
    </div>
  )
}
