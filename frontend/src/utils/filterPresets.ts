import type { PropertyFilters } from '@/types'

export interface SavedFilterPreset {
  id: string
  name: string
  filters: PropertyFilters
  createdAt: string
}

const STORAGE_PREFIX = 'estateos.filter-presets.'

function key(scope: string): string {
  return `${STORAGE_PREFIX}${scope || 'anonymous'}`
}

export function listFilterPresets(scope: string): SavedFilterPreset[] {
  try {
    const raw = window.localStorage.getItem(key(scope))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is SavedFilterPreset => (
      !!item
      && typeof item === 'object'
      && typeof (item as SavedFilterPreset).id === 'string'
      && typeof (item as SavedFilterPreset).name === 'string'
      && typeof (item as SavedFilterPreset).filters === 'object'
    ))
  } catch {
    return []
  }
}

export function saveFilterPreset(scope: string, name: string, filters: PropertyFilters): SavedFilterPreset[] {
  const trimmed = name.trim()
  if (!trimmed) return listFilterPresets(scope)
  const preset: SavedFilterPreset = {
    id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    filters: { ...filters },
    createdAt: new Date().toISOString()
  }
  const presets = [preset, ...listFilterPresets(scope)].slice(0, 12)
  window.localStorage.setItem(key(scope), JSON.stringify(presets))
  return presets
}

export function deleteFilterPreset(scope: string, id: string): SavedFilterPreset[] {
  const presets = listFilterPresets(scope).filter((preset) => preset.id !== id)
  window.localStorage.setItem(key(scope), JSON.stringify(presets))
  return presets
}

export function findFilterPreset(scope: string, id: string): SavedFilterPreset | undefined {
  return listFilterPresets(scope).find((preset) => preset.id === id)
}
