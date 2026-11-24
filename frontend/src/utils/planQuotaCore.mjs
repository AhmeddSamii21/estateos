// Package 40: pure SaaS plan quota math shared by the Vue UI and Node tests.

export const PLAN_LIMITS = Object.freeze({
  FREE: Object.freeze({ users: 50, properties: 200, deals: 1000, storageMb: 100 }),
  STARTER: Object.freeze({ users: 150, properties: 1000, deals: 5000, storageMb: 1000 }),
  GROWTH: Object.freeze({ users: 500, properties: 5000, deals: 25000, storageMb: 10000 }),
  ENTERPRISE: Object.freeze({ users: null, properties: null, deals: null, storageMb: null })
})

export const QUOTA_KEYS = Object.freeze(['users', 'properties', 'deals', 'storageMb'])

export function quotaStatus(used, limit) {
  if (limit === null || limit === undefined) return 'UNLIMITED'
  if (used >= limit) return 'LIMIT_REACHED'
  const percent = limit === 0 ? 100 : (used / limit) * 100
  return percent >= 80 ? 'WARNING' : 'OK'
}

export function quotaPercent(used, limit) {
  if (limit === null || limit === undefined || limit === 0) return null
  return Math.round((used / limit) * 1000) / 10
}

export function quotaRows(usage = {}, limits = {}, language = 'en') {
  const labels = {
    users: ['Team members', 'أعضاء الفريق'],
    properties: ['Properties', 'العقارات'],
    deals: ['Deals', 'الصفقات'],
    storageMb: ['Document storage (MB)', 'مساحة المستندات (ميجابايت)']
  }
  return QUOTA_KEYS.map((key) => {
    const used = Math.max(0, Math.floor(usage[key] || 0))
    const limit = limits[key] === undefined ? (PLAN_LIMITS.FREE[key] ?? null) : limits[key]
    const [english, arabic] = labels[key]
    return {
      key,
      label: language === 'ar' ? arabic : english,
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
      percent: quotaPercent(used, limit),
      status: quotaStatus(used, limit)
    }
  })
}

export function planName(plan, language = 'en') {
  const names = {
    FREE: ['Free', 'مجاني'],
    STARTER: ['Starter', 'مبتدئ'],
    GROWTH: ['Growth', 'نمو'],
    ENTERPRISE: ['Enterprise', 'مؤسسي']
  }
  const pair = names[plan] || names.FREE
  return language === 'ar' ? pair[1] : pair[0]
}

export function upgradeHint(status) {
  if (status === 'UNLIMITED') return 'UNLIMITED'
  if (status === 'LIMIT_REACHED') return 'UPGRADE_REQUIRED'
  if (status === 'WARNING') return 'CONSIDER_UPGRADE'
  return 'HEALTHY'
}
