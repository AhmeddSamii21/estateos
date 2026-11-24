import { createRouter, createWebHistory } from 'vue-router'
import { useStore } from '@/stores'
import type { Role } from '@/types'

const Layout = () => import('@/components/Layout.vue')

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { guest: true, title: 'Login' }
  },
  {
    path: '/',
    component: Layout,
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'Dashboard', component: () => import('@/views/Dashboard.vue'), meta: { title: 'Dashboard' } },
      { path: 'properties', name: 'Properties', component: () => import('@/views/PropertyList.vue'), meta: { title: 'Properties' } },
      { path: 'properties/new', name: 'NewProperty', component: () => import('@/views/PropertyForm.vue'), meta: { title: 'New Property' } },
      { path: 'properties/:id', name: 'PropertyDetail', component: () => import('@/views/PropertyDetail.vue'), props: true, meta: { title: 'Property Details' } },
      { path: 'properties/:id/edit', name: 'EditProperty', component: () => import('@/views/PropertyForm.vue'), props: true, meta: { title: 'Edit Property' } },
      { path: 'leads', name: 'Leads', component: () => import('@/views/ResourceView.vue'), props: { resource: 'leads' }, meta: { title: 'Leads' } },
      { path: 'leads/:id', name: 'LeadDetail', component: () => import('@/views/LeadDetail.vue'), props: true, meta: { title: 'Lead Details' } },
      { path: 'appointments', name: 'Appointments', component: () => import('@/views/ResourceView.vue'), props: { resource: 'appointments' }, meta: { title: 'Appointments' } },
      { path: 'deals', name: 'Deals', component: () => import('@/views/ResourceView.vue'), props: { resource: 'deals' }, meta: { title: 'Deals' } },
      { path: 'deals/:id', name: 'DealDetail', component: () => import('@/views/DealDetail.vue'), props: true, meta: { title: 'Deal Details' } },
      { path: 'finance/payments', name: 'Payments', component: () => import('@/views/ResourceView.vue'), props: { resource: 'payments' }, meta: { title: 'Payments', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] } },
      { path: 'finance/payment-calculator', name: 'PaymentCalculator', component: () => import('@/views/PaymentCalculatorView.vue'), meta: { title: 'Payment calculator' } },
      { path: 'finance/expenses', name: 'Expenses', component: () => import('@/views/ResourceView.vue'), props: { resource: 'expenses' }, meta: { title: 'Expenses', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] } },
      { path: 'finance/commissions', name: 'Commissions', component: () => import('@/views/ResourceView.vue'), props: { resource: 'commissions' }, meta: { title: 'Commissions', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] } },
      { path: 'finance/commission-statements', name: 'CommissionStatements', component: () => import('@/views/CommissionStatementsView.vue'), meta: { title: 'Commission statements' } },
      { path: 'finance/exchange-rates', name: 'ExchangeRates', component: () => import('@/views/SettingsView.vue'), props: { fxOnly: true }, meta: { title: 'Exchange rates', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] } },
      { path: 'maintenance', name: 'Maintenance', component: () => import('@/views/ResourceView.vue'), props: { resource: 'maintenance' }, meta: { title: 'Maintenance' } },
      { path: 'documents', name: 'Documents', component: () => import('@/views/DocumentsView.vue'), meta: { title: 'Documents' } },
      { path: 'search', name: 'AdvancedSearch', component: () => import('@/views/AdvancedSearchView.vue'), meta: { title: 'Advanced Search & Map' } },
      { path: 'reports', name: 'Reports', component: () => import('@/views/ReportsView.vue'), meta: { title: 'Reports & Analytics', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] } },
      { path: 'owners', name: 'Owners', component: () => import('@/views/OwnersView.vue'), meta: { title: 'Owners', roles: ['ADMIN', 'MANAGER'] } },
      { path: 'notifications', name: 'Notifications', component: () => import('@/views/NotificationsView.vue'), meta: { title: 'Notifications' } },
      { path: 'activity', name: 'Activity', component: () => import('@/views/ActivityView.vue'), meta: { title: 'Activity' } },
      { path: 'users', name: 'Users', component: () => import('@/views/ResourceView.vue'), props: { resource: 'users' }, meta: { title: 'Users', roles: ['ADMIN', 'MANAGER', 'TEAM_LEAD'] } },
      { path: 'settings', name: 'Settings', component: () => import('@/views/SettingsView.vue'), meta: { title: 'Settings', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'TEAM_LEAD'] } },
      { path: 'profile', name: 'Profile', component: () => import('@/views/ProfileView.vue'), meta: { title: 'My profile' } }
    ]
  },
  { path: '/p/:shareToken', name: 'PublicProperty', component: () => import('@/views/PublicPropertyView.vue'), meta: { title: 'Property details' } },
  { path: '/owner-portal/:token', name: 'OwnerPortal', component: () => import('@/views/OwnerPortalView.vue'), meta: { title: 'Owner portal' } },
  { path: '/client-portal/:token', name: 'ClientPortal', component: () => import('@/views/ClientPortalView.vue'), meta: { title: 'Client portal' } },
  { path: '/:catchAll(.*)', name: 'NotFound', component: () => import('@/views/NotFound.vue'), meta: { title: 'Not Found' } }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.beforeEach(async (to) => {
  const store = useStore()
  if (!store.authReady) await store.bootstrap()

  if (to.meta.requiresAuth && !store.isAuthenticated) {
    return { name: 'Login', query: { redirect: to.fullPath } }
  }
  if (to.meta.guest && store.isAuthenticated) {
    return { name: 'Dashboard' }
  }
  const roles = to.meta.roles as Role[] | undefined
  if (roles && store.user && !roles.includes(store.user.role)) {
    return { name: 'Dashboard' }
  }
  document.title = `${String(to.meta.title || 'EstateOS')} · EstateOS`
  return true
})

export default router
