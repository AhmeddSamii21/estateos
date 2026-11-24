<template>
  <div class="page" :dir="store.direction">
    <div class="page-head">
      <div>
        <h1>{{ t('My profile') }}</h1>
        <p class="muted">{{ t('Manage your contact details, language, and password.') }}</p>
      </div>
      <span class="role-pill">{{ profile?.role || store.user?.role }}</span>
    </div>

    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="profile-grid">
      <section class="card">
        <h2>{{ t('Account details') }}</h2>
        <div class="identity">
          <img v-if="profile?.avatarUrl || profile?.profileImage" class="avatar" :src="profile.avatarUrl || profile.profileImage || ''" :alt="t('Profile photo')" />
          <span v-else class="avatar avatar-fallback"><i class="fas fa-user"></i></span>
          <div>
            <strong>{{ profile?.firstName || t('Unnamed user') }}</strong>
            <div class="muted">{{ profile?.email }}</div>
          </div>
        </div>
        <dl class="facts">
          <div>
            <dt>{{ t('Last login') }}</dt>
            <dd>{{ formatDate(profile?.lastLoginAt) }}</dd>
          </div>
          <div>
            <dt>{{ t('Login count') }}</dt>
            <dd>{{ profile?.loginCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>{{ t('Status') }}</dt>
            <dd>{{ profile?.isActive === false ? t('Inactive') : t('Active') }}</dd>
          </div>
          <div>
            <dt>{{ t('Monthly target') }}</dt>
            <dd>{{ money(profile?.monthlyTargetAmount) }}</dd>
          </div>
        </dl>
      </section>

      <section class="card">
        <h2>{{ t('Edit profile') }}</h2>
        <form class="form" @submit.prevent="saveProfile">
          <label>
            <span>{{ t('First name') }}</span>
            <input v-model="form.firstName" type="text" maxlength="100" />
          </label>
          <label>
            <span>{{ t('Phone') }}</span>
            <input v-model="form.phone" type="tel" maxlength="50" dir="ltr" />
          </label>
          <label>
            <span>{{ t('Job title') }}</span>
            <input v-model="form.jobTitle" type="text" maxlength="120" />
          </label>
          <label class="full">
            <span>{{ t('Avatar URL') }}</span>
            <input v-model="form.avatarUrl" type="url" maxlength="2048" dir="ltr" placeholder="https://…" />
          </label>
          <label>
            <span>{{ t('Preferred language') }}</span>
            <select v-model="form.preferredLang">
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
          <div class="form-actions full">
            <button class="btn btn-primary no-print" type="submit" :disabled="saving">
              {{ saving ? t('Saving…') : t('Save profile') }}
            </button>
          </div>
        </form>
      </section>

      <section class="card full-card">
        <h2>{{ t('Change password') }}</h2>
        <p class="muted">{{ t('A successful password change signs you out of every device.') }}</p>
        <form class="form" @submit.prevent="savePassword">
          <label>
            <span>{{ t('Current password') }}</span>
            <input v-model="passwords.currentPassword" type="password" autocomplete="current-password" required />
          </label>
          <label>
            <span>{{ t('New password') }}</span>
            <input v-model="passwords.newPassword" type="password" autocomplete="new-password" minlength="8" required />
          </label>
          <label>
            <span>{{ t('Confirm password') }}</span>
            <input v-model="passwords.confirmPassword" type="password" autocomplete="new-password" minlength="8" required />
          </label>
          <div class="form-actions full">
            <button class="btn btn-quiet no-print" type="submit" :disabled="changing">
              {{ changing ? t('Updating…') : t('Update password') }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiGet, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import type { AuthUser } from '@/types'

const LABELS: Record<string, [string, string]> = {
  'My profile': ['My profile', 'ملفي الشخصي'],
  'Manage your contact details, language, and password.': ['Manage your contact details, language, and password.', 'إدارة بيانات الاتصال واللغة وكلمة المرور.'],
  'Account details': ['Account details', 'بيانات الحساب'],
  'Edit profile': ['Edit profile', 'تعديل الملف الشخصي'],
  'Profile photo': ['Profile photo', 'صورة الملف الشخصي'],
  'Unnamed user': ['Unnamed user', 'مستخدم بدون اسم'],
  'Last login': ['Last login', 'آخر دخول'],
  'Login count': ['Login count', 'عدد مرات الدخول'],
  Status: ['Status', 'الحالة'],
  'Monthly target': ['Monthly target', 'الهدف الشهري'],
  Active: ['Active', 'نشط'],
  Inactive: ['Inactive', 'غير نشط'],
  'First name': ['First name', 'الاسم الأول'],
  Phone: ['Phone', 'الهاتف'],
  'Job title': ['Job title', 'المسمى الوظيفي'],
  'Avatar URL': ['Avatar URL', 'رابط الصورة'],
  'Preferred language': ['Preferred language', 'اللغة المفضلة'],
  'Save profile': ['Save profile', 'حفظ الملف الشخصي'],
  'Saving…': ['Saving…', 'جارٍ الحفظ…'],
  'Change password': ['Change password', 'تغيير كلمة المرور'],
  'A successful password change signs you out of every device.': ['A successful password change signs you out of every device.', 'بعد تغيير كلمة المرور سيتم تسجيل الخروج من جميع الأجهزة.'],
  'Current password': ['Current password', 'كلمة المرور الحالية'],
  'New password': ['New password', 'كلمة المرور الجديدة'],
  'Confirm password': ['Confirm password', 'تأكيد كلمة المرور'],
  'Update password': ['Update password', 'تحديث كلمة المرور'],
  'Updating…': ['Updating…', 'جارٍ التحديث…'],
  'Profile updated successfully': ['Profile updated successfully', 'تم تحديث الملف الشخصي بنجاح'],
  'Password changed. Please sign in again.': ['Password changed. Please sign in again.', 'تم تغيير كلمة المرور. سجّل الدخول مرة أخرى.']
}

function t(key: string): string {
  const pair = LABELS[key]
  return pair ? (store.isArabic ? pair[1] : pair[0]) : key
}

const store = useStore()
const router = useRouter()
const profile = ref<AuthUser | null>(store.user)
const saving = ref(false)
const changing = ref(false)
const message = ref('')
const error = ref('')
const form = reactive({
  firstName: '',
  phone: '',
  jobTitle: '',
  avatarUrl: '',
  preferredLang: 'en' as 'en' | 'ar'
})
const passwords = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })

function syncForm(value: AuthUser): void {
  profile.value = value
  form.firstName = value.firstName || ''
  form.phone = value.phone || ''
  form.jobTitle = value.jobTitle || ''
  form.avatarUrl = value.avatarUrl || ''
  form.preferredLang = value.preferredLang === 'ar' ? 'ar' : 'en'
}

onMounted(async () => {
  try {
    const response = await apiGet<AuthUser>('/auth/me')
    syncForm(response.data)
  } catch (e) {
    error.value = errorMessage(e)
  }
})

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(store.isArabic ? 'ar-EG-u-nu-latn' : 'en-GB')
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat(store.isArabic ? 'ar-EG-u-nu-latn' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(Number(value))
}

async function saveProfile(): Promise<void> {
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const updated = await store.updateProfile({
      firstName: form.firstName,
      phone: form.phone,
      jobTitle: form.jobTitle,
      avatarUrl: form.avatarUrl,
      preferredLang: form.preferredLang
    })
    syncForm(updated)
    message.value = t('Profile updated successfully')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}

async function savePassword(): Promise<void> {
  error.value = ''
  message.value = ''
  if (passwords.newPassword !== passwords.confirmPassword) {
    error.value = store.isArabic ? 'كلمتا المرور الجديدتان غير متطابقتين.' : 'New passwords do not match.'
    return
  }
  if (passwords.newPassword.length < 8 || !/[A-Za-z]/.test(passwords.newPassword) || !/\d/.test(passwords.newPassword)) {
    error.value = store.isArabic
      ? 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل وتحتوي على حرف ورقم.'
      : 'Password must be at least 8 characters and include a letter and a number.'
    return
  }
  changing.value = true
  try {
    await store.changePassword(passwords.currentPassword, passwords.newPassword)
    message.value = t('Password changed. Please sign in again.')
    passwords.currentPassword = ''
    passwords.newPassword = ''
    passwords.confirmPassword = ''
    await store.logout()
    await router.push('/login')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    changing.value = false
  }
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; max-width: 1080px; }
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
h1 { margin: 0; font-size: 1.5rem; }
h2 { margin: 0 0 1rem; font-size: 1.1rem; }
.muted { color: #6b7280; margin: 0.25rem 0 0; font-size: 0.85rem; }
.role-pill { background: #eef2ff; color: #3730a3; border-radius: 999px; padding: 0.3rem 0.8rem; font-size: 0.75rem; font-weight: 700; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.2rem; }
.profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.full-card { grid-column: 1 / -1; }
.identity { display: flex; align-items: center; gap: 0.9rem; margin-bottom: 1rem; }
.avatar { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 1px solid #e5e7eb; }
.avatar-fallback { display: inline-flex; align-items: center; justify-content: center; background: #eef2ff; color: #3730a3; font-size: 1.5rem; }
.facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; margin: 0; }
.facts div { background: #f9fafb; border-radius: 8px; padding: 0.6rem 0.75rem; }
.facts dt { color: #6b7280; font-size: 0.72rem; }
.facts dd { margin: 0.2rem 0 0; font-size: 0.9rem; font-weight: 600; }
.form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.85rem; }
.form label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.82rem; color: #374151; }
.form label.full, .form-actions { grid-column: 1 / -1; }
.form input, .form select { border: 1px solid #d1d5db; border-radius: 8px; padding: 0.55rem 0.7rem; font-size: 0.9rem; }
.form-actions { display: flex; justify-content: flex-start; }
.btn { border: 0; border-radius: 8px; padding: 0.6rem 1rem; font-size: 0.86rem; cursor: pointer; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-primary:disabled, .btn-quiet:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.notice { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; border-radius: 8px; padding: 0.7rem 0.9rem; margin: 0; }
.alert { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; border-radius: 8px; padding: 0.7rem 0.9rem; margin: 0; }

@media (max-width: 760px) {
  .profile-grid, .form, .facts { grid-template-columns: 1fr; }
  .full-card { grid-column: auto; }
}
</style>
