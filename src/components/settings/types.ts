import type { AppSettings } from '../../types'

/** 各设置分段组件共用的基础 props。 */
export interface SectionProps {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  en: boolean
}
