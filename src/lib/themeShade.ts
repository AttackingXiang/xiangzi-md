/**
 * 只调整背景/表面这一档变量的深浅，不动文字与代码语法色——保持可读性的前提
 * 下让"当前主题"整体更浅或更深，而不是让用户在 6 个离散预设之外别无选择。
 */
const SHADE_VARS = [
  '--bg',
  '--bg-sidebar',
  '--bg-elevated',
  '--bg-hover',
  '--bg-active',
  '--border',
  '--border-strong',
  '--code-card-bg',
  '--code-card-border',
  '--code-header-bg',
]

function mixColor(expression: string): string {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;'
  probe.style.color = expression
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved
}

/**
 * shade: -50（更深）到 50（更浅），0 表示按主题原色不做任何调整。
 *
 * 每次调用先清掉上一次写的 inline 覆盖，再基于 getComputedStyle 读到的
 * （此时必然是主题 CSS 规则本身的）基准色重新计算——否则连续调节滑块会在
 * 上一次结果上又叠一次色相偏移，越调越偏而不是相对主题原色的绝对深浅。
 */
export function applyThemeShade(shade: number): void {
  const root = document.documentElement
  for (const name of SHADE_VARS) root.style.removeProperty(name)
  // 加深最多 10%，变亮最多 50%——防止历史上存过的更深值仍被应用。
  const clamped = Math.min(50, Math.max(-10, shade))
  if (clamped === 0) return

  const mixWith = clamped > 0 ? 'white' : 'black'
  const amount = Math.abs(clamped)
  const style = getComputedStyle(root)
  for (const name of SHADE_VARS) {
    const base = style.getPropertyValue(name).trim()
    if (!base) continue
    root.style.setProperty(name, mixColor(`color-mix(in srgb, ${mixWith} ${amount}%, ${base})`))
  }
}
