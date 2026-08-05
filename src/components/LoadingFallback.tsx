import { t } from '../lib/i18n'

/**
 * 懒加载界面的占位。
 *
 * 之前这些 Suspense 边界一律 `fallback={null}`，于是打开设置（102 KB chunk）
 * 或命令面板是「点了没反应，然后突然出现」。小弹窗保持 null 是合理的——它们
 * 又小又快，闪一下占位反而更吵；占据可见区域的面板才需要占位。
 */

/** 侧栏/结果列等占据版面的面板。 */
export function PanelFallback(): JSX.Element {
  return (
    <div className="loading-panel" role="status" aria-label={t('加载中')}>
      <span className="loading-spinner" aria-hidden="true" />
    </div>
  )
}

/**
 * 模态类界面。先把遮罩画出来——光是遮罩立刻出现，交互就已经"有反应"了，
 * 剩下的加载时间就不再像卡住。
 */
export function ModalFallback(): JSX.Element {
  return (
    <div className="modal-backdrop loading-backdrop" role="status" aria-label={t('加载中')}>
      <span className="loading-spinner" aria-hidden="true" />
    </div>
  )
}
