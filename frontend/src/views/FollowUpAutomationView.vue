<template>
  <div class="page" :dir="store.direction">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'أتمتة المتابعة' : 'Follow-up automation' }}</h1>
        <p class="muted">
          {{ store.isArabic
            ? 'قواعد خاصة بكل مؤسسة تنشئ مهام متابعة تلقائياً من العملاء والصفقات.'
            : 'Tenant-owned rules create follow-up tasks from leads and stalled deals.' }}
        </p>
      </div>
      <div class="head-actions no-print">
        <button v-if="canEvaluate" class="btn btn-primary" type="button" :disabled="running" @click="evaluate">
          <i class="fas fa-bolt"></i> {{ running ? '…' : (store.isArabic ? 'تشغيل الآن' : 'Run now') }}
        </button>
        <button class="btn btn-quiet" type="button" :disabled="loading" @click="load">
          <i class="fas fa-rotate"></i> {{ store.isArabic ? 'تحديث' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="runMessage" class="alert alert-success" role="status">{{ runMessage }}</div>
    <div v-else-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <template v-else>
      <section class="stats">
        <article class="stat"><span>{{ store.isArabic ? 'قواعد نشطة' : 'Active rules' }}</span><strong>{{ summary.rules }}</strong></article>
        <article class="stat"><span>{{ store.isArabic ? 'مهام قيد الانتظار' : 'Pending tasks' }}</span><strong>{{ summary.pending }}</strong></article>
        <article class="stat"><span>{{ store.isArabic ? 'مهام متأخرة' : 'Overdue' }}</span><strong>{{ summary.overdue }}</strong></article>
        <article class="stat"><span>{{ store.isArabic ? 'مكتملة' : 'Completed' }}</span><strong>{{ summary.completed }}</strong></article>
      </section>

      <div class="automation-layout">
        <section class="panel">
          <div class="panel-head">
            <h2>{{ store.isArabic ? 'قواعد المتابعة' : 'Automation rules' }}</h2>
            <span class="muted">{{ rules.length }}</span>
          </div>
          <form v-if="canManage" class="rule-form" @submit.prevent="createRule">
            <label>
              <span>{{ store.isArabic ? 'اسم القاعدة' : 'Rule name' }}</span>
              <input v-model="form.name" required maxlength="120" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'الاسم بالعربية' : 'Arabic name' }}</span>
              <input v-model="form.nameAr" maxlength="120" dir="rtl" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'المحفّز' : 'Trigger' }}</span>
              <select v-model="form.trigger">
                <option v-for="trigger in triggerKeys" :key="trigger" :value="trigger">{{ triggerLabel(trigger, store.isArabic ? 'ar' : 'en') }}</option>
              </select>
            </label>
            <label>
              <span>{{ store.isArabic ? 'بعد أيام' : 'After days' }}</span>
              <input v-model.number="form.conditionDays" type="number" min="0" max="365" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'القناة' : 'Channel' }}</span>
              <select v-model="form.channel">
                <option v-for="channel in channelKeys" :key="channel" :value="channel">{{ channelLabel(channel, store.isArabic ? 'ar' : 'en') }}</option>
              </select>
            </label>
            <label>
              <span>{{ store.isArabic ? 'القالب' : 'Template' }}</span>
              <input v-model="form.template" required maxlength="500" placeholder="Follow up with {{client_name}}" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'القالب بالعربية' : 'Arabic template' }}</span>
              <input v-model="form.templateAr" maxlength="500" dir="rtl" placeholder="تابع مع {{client_name}}" />
            </label>
            <div class="inline-row">
              <label>
                <span>{{ store.isArabic ? 'الأولوية' : 'Priority' }}</span>
                <input v-model.number="form.priority" type="number" min="-100" max="100" />
              </label>
              <label class="checkbox">
                <input v-model="form.isActive" type="checkbox" />
                <span>{{ store.isArabic ? 'نشطة' : 'Active' }}</span>
              </label>
            </div>
            <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '…' : (store.isArabic ? 'إضافة قاعدة' : 'Add rule') }}</button>
          </form>
          <p v-else class="muted">{{ store.isArabic ? 'مديرو المؤسسة فقط هم من يديرون القواعد.' : 'Only organization managers can manage rules.' }}</p>

          <article v-for="rule in rules" :key="rule.id" class="rule-row">
            <div class="rule-head">
              <strong>{{ store.isArabic ? (rule.nameAr || rule.name) : rule.name }}</strong>
              <span class="status-pill" :class="rule.isActive ? 'quota-ok' : ''">
                {{ rule.isActive ? (store.isArabic ? 'نشطة' : 'Active') : (store.isArabic ? 'متوقفة' : 'Paused') }}
              </span>
            </div>
            <p class="muted">
              {{ triggerLabel(rule.trigger, store.isArabic ? 'ar' : 'en') }} ·
              {{ store.isArabic ? `بعد ${rule.conditionDays} يوم` : `after ${rule.conditionDays} day(s)` }} ·
              {{ channelLabel(rule.channel, store.isArabic ? 'ar' : 'en') }}
            </p>
            <code>{{ renderTemplate(store.isArabic ? (rule.templateAr || rule.template) : rule.template, sampleVariables) }}</code>
            <div v-if="canManage" class="rule-actions no-print">
              <button class="btn btn-quiet" type="button" @click="toggleRule(rule)">
                {{ rule.isActive ? (store.isArabic ? 'إيقاف' : 'Pause') : (store.isArabic ? 'تفعيل' : 'Activate') }}
              </button>
              <button class="btn btn-quiet" type="button" @click="deleteRule(rule)">{{ store.isArabic ? 'حذف' : 'Delete' }}</button>
            </div>
          </article>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>{{ store.isArabic ? 'مهام المتابعة' : 'Generated tasks' }}</h2>
            <select v-model="taskFilter" :aria-label="store.isArabic ? 'الحالة' : 'Status'">
              <option value="">{{ store.isArabic ? 'كل الحالات' : 'All statuses' }}</option>
              <option v-for="status in statusKeys" :key="status" :value="status">{{ taskStatusLabel(status, store.isArabic ? 'ar' : 'en') }}</option>
            </select>
          </div>
          <article v-for="task in filteredTasks" :key="task.id" class="task-row" :class="`task-${task.status.toLowerCase()}`">
            <div class="task-head">
              <strong>{{ store.isArabic ? (task.titleAr || task.title) : task.title }}</strong>
              <span>{{ new Date(task.dueAt).toLocaleDateString(store.isArabic ? 'ar' : 'en') }}</span>
            </div>
            <p class="muted">
              {{ task.rule?.name }} ·
              {{ task.lead ? `${task.lead.firstName} ${task.lead.lastName || ''}`.trim() : task.deal?.referenceNumber || '—' }}
            </p>
            <div class="task-actions no-print">
              <button
                v-if="task.status === 'PENDING'"
                class="btn btn-quiet"
                type="button"
                @click="updateTask(task, 'COMPLETED')"
              >{{ store.isArabic ? 'تم' : 'Complete' }}</button>
              <button
                v-if="task.status === 'PENDING'"
                class="btn btn-quiet"
                type="button"
                @click="updateTask(task, 'CANCELLED')"
              >{{ store.isArabic ? 'إلغاء' : 'Cancel' }}</button>
            </div>
          </article>
          <p v-if="!filteredTasks.length" class="state">{{ store.isArabic ? 'لا توجد مهام.' : 'No tasks yet.' }}</p>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import {
  channelLabel,
  CHANNELS,
  renderTemplate,
  taskStatusLabel,
  TASK_STATUSES,
  TRIGGERS,
  triggerLabel
} from '@/utils/followUpCore.mjs'

interface Rule {
  id: string
  name: string
  nameAr: string | null
  trigger: string
  conditionDays: number
  channel: string
  template: string
  templateAr: string | null
  priority: number
  isActive: boolean
}
interface Task {
  id: string
  title: string
  titleAr: string | null
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED'
  dueAt: string
  rule?: { name: string }
  lead?: { firstName: string; lastName: string | null }
  deal?: { referenceNumber: string | null }
}
interface Summary { rules: number; pending: number; completed: number; overdue: number }

const store = useStore()
const triggerKeys = Object.keys(TRIGGERS)
const channelKeys = Object.keys(CHANNELS)
const statusKeys = Object.keys(TASK_STATUSES)
const sampleVariables = { client_name: 'Client', agent_name: 'Agent', deal_reference: 'REF', due_date: '—' }
const canManage = computed(() => store.user?.role === 'ADMIN' || store.user?.role === 'MANAGER')
const canEvaluate = computed(() => canManage.value || store.user?.role === 'TEAM_LEAD')

const rules = ref<Rule[]>([])
const tasks = ref<Task[]>([])
const summary = ref<Summary>({ rules: 0, pending: 0, completed: 0, overdue: 0 })
const taskFilter = ref('')
const loading = ref(false)
const saving = ref(false)
const running = ref(false)
const error = ref('')
const runMessage = ref('')
const form = reactive({
  name: '',
  nameAr: '',
  trigger: 'NEW_LEAD',
  conditionDays: 3,
  channel: 'NOTIFICATION',
  template: 'Follow up with {{client_name}}',
  templateAr: 'تابع مع {{client_name}}',
  priority: 0,
  isActive: true
})

const filteredTasks = computed(() => taskFilter.value ? tasks.value.filter((task) => task.status === taskFilter.value) : tasks.value)

onMounted(load)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [ruleResponse, taskResponse, summaryResponse] = await Promise.all([
      apiGet<Rule[]>('/follow-ups/rules'),
      apiGet<Task[]>('/follow-ups/tasks'),
      apiGet<Summary>('/follow-ups/summary')
    ])
    rules.value = ruleResponse.data || []
    tasks.value = taskResponse.data || []
    summary.value = summaryResponse.data || summary.value
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function createRule(): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    await apiPost('/follow-ups/rules', form)
    form.name = ''
    form.nameAr = ''
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}

async function toggleRule(rule: Rule): Promise<void> {
  error.value = ''
  try {
    await apiPatch(`/follow-ups/rules/${rule.id}`, { isActive: !rule.isActive })
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function deleteRule(rule: Rule): Promise<void> {
  error.value = ''
  try {
    await apiDelete(`/follow-ups/rules/${rule.id}`)
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function updateTask(task: Task, status: 'COMPLETED' | 'CANCELLED'): Promise<void> {
  error.value = ''
  try {
    await apiPatch(`/follow-ups/tasks/${task.id}/status`, { status })
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function evaluate(): Promise<void> {
  running.value = true
  error.value = ''
  runMessage.value = ''
  try {
    const response = await apiPost<{ created: number; skipped: number; evaluatedRules: number }>('/follow-ups/evaluate', {})
    runMessage.value = store.isArabic
      ? `تم إنشاء ${response.data?.created || 0} مهمة وتخطي ${response.data?.skipped || 0} مهمة.`
      : `Created ${response.data?.created || 0} task(s), skipped ${response.data?.skipped || 0}.`
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    running.value = false
  }
}
</script>

<style scoped>
.automation-layout { display: grid; grid-template-columns: minmax(300px, 420px) 1fr; gap: 1rem; align-items: start; }
.rule-form { display: grid; gap: 0.6rem; margin-bottom: 1rem; }
.inline-row { display: flex; gap: 0.8rem; align-items: flex-end; }
.checkbox { display: flex; align-items: center; gap: 0.4rem; }
.rule-row, .task-row { padding: 0.7rem 0; border-top: 1px solid var(--border, #eef2f7); }
.rule-head, .task-head { display: flex; justify-content: space-between; gap: 0.5rem; }
.rule-actions, .task-actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
.rule-row code { display: block; margin-top: 0.35rem; font-size: 0.78rem; color: var(--muted, #64748b); }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.task-pending { border-inline-start: 4px solid #F59E0B; padding-inline-start: 0.6rem; }
.task-completed { border-inline-start: 4px solid #16A34A; padding-inline-start: 0.6rem; }
.task-cancelled { border-inline-start: 4px solid #6B7280; padding-inline-start: 0.6rem; }
@media (max-width: 950px) { .automation-layout { grid-template-columns: 1fr; } }
</style>
