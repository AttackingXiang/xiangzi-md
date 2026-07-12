import { useEffect, useState } from 'react'

/**
 * 返回一个大致的「现在」时间戳（Unix 毫秒），挂载后取值并按 intervalMs 周期刷新。
 * 用于 frecency 等随时间衰减的计算，避免在 render 中直接调用 Date.now()（不纯，且会
 * 被 react-hooks/purity 规则拦下）。首帧返回 0——此时衰减一律取满权，随后刷新校正。
 */
export function useNow(intervalMs = 5 * 60_000): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
