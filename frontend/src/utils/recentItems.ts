export interface RecentItem {
  id: string
  type: string
  title: string
  route: string
  visitedAt: string
}

const STORAGE_PREFIX = 'estateos.recent-items.'

function key(scope: string): string {
  return `${STORAGE_PREFIX}${scope || 'anonymous'}`
}

export function listRecentItems(scope: string): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(key(scope))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is RecentItem => (
      !!item
      && typeof item === 'object'
      && typeof (item as RecentItem).id === 'string'
      && typeof (item as RecentItem).route === 'string'
    )).slice(0, 8)
  } catch {
    return []
  }
}

export function pushRecentItem(scope: string, item: Omit<RecentItem, 'visitedAt'>): RecentItem[] {
  const entry: RecentItem = { ...item, visitedAt: new Date().toISOString() }
  const items = [entry, ...listRecentItems(scope).filter((existing) => (
    !(existing.id === entry.id && existing.type === entry.type)
  ))].slice(0, 8)
  window.localStorage.setItem(key(scope), JSON.stringify(items))
  return items
}

export function clearRecentItems(scope: string): void {
  window.localStorage.removeItem(key(scope))
}
