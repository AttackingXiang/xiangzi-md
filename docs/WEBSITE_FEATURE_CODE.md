# 代码块

代码围栏拥有语言识别、语法高亮与复制能力。

```typescript
type Feature = 'images' | 'tables' | 'mermaid' | 'highlight'

export function renderFeature(feature: Feature) {
  return `Xiangzi MD renders ${feature} in place.`
}
```

代码仍然保存在普通 Markdown 文件中。
