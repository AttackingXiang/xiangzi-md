import { createContext } from 'react'

// focusedPath 通过 Context 下发而非 prop：FileTree 递归渲染自身，若把 focusedPath 逐层
// 当 prop 传给每个 memo() 的 TreeNode（哪怕只是为了转发给内层 <FileTree>），一次按键就会
// 让路径上所有已展开目录的 TreeNode 都因为 props 变化而重渲染。Context 只会让实际调用
// useContext 的组件（这里是每一层 FileTree 自身）重新执行，中间的 TreeNode 只要拿到的
// isRovingTabStop 布尔值没变，memo() 就能照常跳过。
export const FocusedPathContext = createContext<string | null>(null)
