export interface DocumentMeta {
  path: string
  name: string
  title: string
  excerpt: string
  updatedAt: number
  tags: string[]
}

export type TagIndex = Record<string, DocumentMeta[]>

export type TagSidebarMode = 'tags' | 'related' | null
