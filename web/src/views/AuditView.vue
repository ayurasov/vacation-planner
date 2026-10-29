<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, type AuditEvent, type Page } from '@/api/client';
import AppIcon from '@/components/common/AppIcon.vue';
import LoginJournal from '@/components/LoginJournal.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';

const PER_PAGE = 50;
const events = ref<AuditEvent[]>([]);
const total = ref(0);
const page = ref(1);
const entity = ref('');
const loading = ref(true);
const error = ref('');
const expanded = ref<Set<number>>(new Set());
// Журнал изменений данных и журнал входов (v0.6.0) — две вкладки одного раздела
const tab = ref<'changes' | 'logins'>('changes');

const ACTIONS: Record<string, { label: string; tone: string; icon: string }> = {
  'request.created': { label: 'Создана заявка', tone: 'info', icon: 'plus' },
  'request.updated': { label: 'Изменена заявка / перенос', tone: 'warning', icon: 'swap' },
  'request.approved': { label: 'Заявка согласована', tone: 'success', icon: 'check' },
  'request.rejected': { label: 'Заявка отклонена', tone: 'danger', icon: 'close' },
  'request.cancelled': { label: 'Заявка отменена', tone: 'muted', icon: 'undo' },
  'request.deletion_requested': { label: 'Запрошено удаление', tone: 'warning', icon: 'trash' },
  'request.deleted': { label: 'Отпуск удалён', tone: 'danger', icon: 'trash' },
  'employee.created': { label: 'Добавлен сотрудник', tone: 'info', icon: 'user' },
  'employee.updated': { label: 'Изменён сотрудник', tone: 'muted', icon: 'edit' },
  'employee.deactivated': { label: 'Сотрудник уволен', tone: 'danger', icon: 'logout' },
  'employee.work_pattern_updated': { label: 'Изменён график работы', tone: 'muted', icon: 'schedule' },
  'employee.work_override_set': { label: 'Исключение в графике работы', tone: 'muted', icon: 'schedule' },
  'employee.work_override_removed': { label: 'Снято исключение графика', tone: 'muted', icon: 'schedule' },
  'department.created': { label: 'Создан отдел', tone: 'info', icon: 'building' },
  'department.updated': { label: 'Изменён отдел', tone: 'muted', icon: 'building' },
  'department.deleted': { label: 'Удалён отдел', tone: 'danger', icon: 'building' },
  'project.created': { label: 'Создан проект', tone: 'info', icon: 'briefcase' },
  'project.updated': { label: 'Изменён проект', tone: 'muted', icon: 'briefcase' },
  'project.deleted': { label: 'Удалён проект', tone: 'danger', icon: 'briefcase' },
  'settings.updated': { label: 'Изменены правила', tone: 'violet', icon: 'sliders' },
  'calendar.created': { label: 'Загружен календарь года', tone: 'info', icon: 'schedule' },
  'calendar.updated': { label: 'Изменён календарь года', tone: 'violet', icon: 'schedule' },
  'employee.password_reset': { label: 'Сброшен пароль', tone: 'warning', icon: 'key' },
  'import.applied': { label: 'Импорт сотрудников', tone: 'info', icon: 'upload' },
  'employee.preferences_updated': { label: 'Изменены личные настройки', tone: 'muted', icon: 'mail' },
  'report.exported': { label: 'Выгрузка в Excel', tone: 'muted', icon: 'spreadsheet' },
  'employee.unlocked': { label: 'Снята блокировка входа', tone: 'warning', icon: 'key' },
  'employee.sessions_revoked': { label: 'Завершены сеансы сотрудника', tone: 'warning', icon: 'logout' },
  'delegation.created': { label: 'Назначено замещение', tone: 'info', icon: 'swap' },
  'delegation.revoked': { label: 'Отменено замещение', tone: 'muted', icon: 'swap' },
  'request.escalated': { label: 'Заявка передана вышестоящему', tone: 'warning', icon: 'clock' },
  'notice.acknowledged': { label: 'Ознакомлен с извещением', tone: 'success', icon: 'signature' },
  'planning.opened': { label: 'Открыто планирование', tone: 'info', icon: 'schedule' },
  'planning.updated': { label: 'Изменён срок планирования', tone: 'muted', icon: 'schedule' },
  'planning.closed': { label: 'Закрыто планирование', tone: 'muted', icon: 'schedule' },
  'planning.reminded': { label: 'Напоминание о планировании', tone: 'muted', icon: 'bell' },
  'schedule.approved': { label: 'Утверждён график отпусков', tone: 'success', icon: 'check' },
};

const ENTITIES = [
  { key: '', label: 'Все объекты' },
  { key: 'vacation_request', label: 'Заявки' },
  { key: 'employee', label: 'Сотрудники' },
  { key: 'department', label: 'Отделы' },
  { key: 'project', label: 'Проекты' },
  { key: 'org_settings', label: 'Настройки' },
  { key: 'calendar', label: 'Календарь' },
  { key: 'import', label: 'Импорт' },
  { key: 'report', label: 'Выгрузки' },
  { key: 'delegation', label: 'Замещения' },
  { key: 'vacation_notice', label: 'Извещения' },
  { key: 'planning_campaign', label: 'Планирование' },
  { key: 'schedule_approval', label: 'Утверждение графика' },
];

const FIELD_LABELS: Record<string, string> = {
  status: 'статус', start: 'начало', end: 'окончание', name: 'название', managerId: 'руководитель',
  plannedDays: 'норма', carryOver: 'перенос', deptId: 'отдел', position: 'должность', role: 'роль',
  email: 'email', emailNotifications: 'письма', create: 'новых', update: 'изменено', unchanged: 'без изменений', error: 'ошибок', newDepartments: 'новые отделы', source: 'источник',
  isAdmin: 'администратор', isHr: 'кадровая служба', holidays: 'праздники', transfers: 'переносы', empType: 'тип', conflictThreshold: 'порог', limitPolicy: 'лимит', period: 'период',
  personnelNumber: 'табельный номер', deadline: 'срок', open: 'открыто', sent: 'отправлено', docNumber: 'номер документа', docDate: 'дата документа', rows: 'строк',
};

const pages = computed(() => Math.max(1, Math.ceil(total.value / PER_PAGE)));

function meta(action: string) {
  return ACTIONS[action] ?? { label: action, tone: 'muted', icon: 'info' };
}

/** Изменённые поля: только различающиеся значения, без служебных. */
function diff(e: AuditEvent): Array<{ key: string; before: string; after: string }> {
  const keys = new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})]);
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return [...keys]
    .filter((k) => !['id', 'login', 'createdAt', 'updatedAt'].includes(k))
    .map((k) => ({ key: FIELD_LABELS[k] ?? k, before: show(e.before?.[k]), after: show(e.after?.[k]) }))
    .filter((d) => d.before !== d.after);
}

function when(ts: string): string {
  return new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toggle(id: number): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  expanded.value = next;
}

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const q = new URLSearchParams({ page: String(page.value), per_page: String(PER_PAGE) });
    if (entity.value) q.set('entity', entity.value);
    const data = await api.get<Page<AuditEvent>>(`/audit-events?${q}`);
    events.value = data.items;
    total.value = data.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

watch(entity, () => { page.value = 1; void reload(); });
watch(page, reload);
onMounted(reload);
</script>

<template>
  <div class="page-narrow">
    <div class="view-header">
      <div>
        <div class="view-title">
          Журнал аудита
        </div>
        <div class="view-subtitle">
          {{ tab === 'changes' ? `${total} записей · неизменяемый журнал всех изменений данных` : 'Входы в систему: успешные, неудачные, блокировки' }}
        </div>
      </div>
      <div class="segmented">
        <button
          type="button"
          :class="{ active: tab === 'changes' }"
          :aria-pressed="tab === 'changes'"
          @click="tab = 'changes'"
        >
          Изменения
        </button>
        <button
          type="button"
          :class="{ active: tab === 'logins' }"
          :aria-pressed="tab === 'logins'"
          @click="tab = 'logins'"
        >
          Входы
        </button>
      </div>
    </div>

    <LoginJournal v-if="tab === 'logins'" />

    <template v-else>
      <select
        v-model="entity"
        class="input entity-filter"
        aria-label="Тип объекта"
      >
        <option
          v-for="e in ENTITIES"
          :key="e.key"
          :value="e.key"
        >
          {{ e.label }}
        </option>
      </select>

      <div
        v-if="error"
        class="banner banner-error"
      >
        <AppIcon
          name="warning"
          :size="15"
        /> {{ error }}
      </div>

      <div class="card">
        <div
          v-if="loading"
          class="card-body"
        >
          <div
            v-for="i in 8"
            :key="i"
            class="skeleton"
            style="height: 40px; margin-bottom: 8px"
          />
        </div>
        <EmptyState
          v-else-if="!events.length"
          icon="shield"
          title="Записей нет"
          text="Изменения данных появятся здесь автоматически."
        />
        <ol
          v-else
          class="timeline"
        >
          <li
            v-for="e in events"
            :key="e.id"
            class="event"
          >
            <span
              class="event-icon"
              :class="`tone-${meta(e.action).tone}`"
            ><AppIcon
              :name="meta(e.action).icon"
              :size="14"
            /></span>
            <div class="event-main">
              <div class="event-line">
                <strong>{{ meta(e.action).label }}</strong>
                <span class="soft small">#{{ e.entityId }}</span>
              </div>
              <div class="event-meta">
                <span
                  v-if="e.actorName"
                  class="person"
                >
                  <UserAvatar
                    :name="e.actorName"
                    :size="18"
                  />
                  <span class="small">{{ e.actorName }}</span>
                </span>
                <span
                  v-else
                  class="small soft"
                >система</span>
                <span class="small soft">{{ when(e.ts) }}</span>
                <button
                  v-if="diff(e).length"
                  class="link-btn"
                  type="button"
                  @click="toggle(e.id)"
                >
                  {{ expanded.has(e.id) ? 'скрыть' : `изменения (${diff(e).length})` }}
                </button>
              </div>
              <table
                v-if="expanded.has(e.id)"
                class="diff"
              >
                <tr
                  v-for="d in diff(e)"
                  :key="d.key"
                >
                  <td class="muted">
                    {{ d.key }}
                  </td>
                  <td><span class="before">{{ d.before }}</span></td>
                  <td>
                    <AppIcon
                      name="arrowRight"
                      :size="12"
                    />
                  </td>
                  <td><span class="after">{{ d.after }}</span></td>
                </tr>
              </table>
            </div>
          </li>
        </ol>
        <div
          v-if="pages > 1"
          class="pager"
        >
          <span class="muted small">Стр. {{ page }} из {{ pages }}</span>
          <div class="toolbar">
            <button
              class="btn btn-sm"
              type="button"
              :disabled="page <= 1"
              @click="page--"
            >
              <AppIcon
                name="chevronLeft"
                :size="14"
              /> Новее
            </button>
            <button
              class="btn btn-sm"
              type="button"
              :disabled="page >= pages"
              @click="page++"
            >
              Старше <AppIcon
                name="chevronRight"
                :size="14"
              />
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.entity-filter {
  width: auto;
  margin-bottom: 12px;
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 6px 0;
}

.event {
  display: flex;
  gap: 12px;
  padding: 10px 16px;
  position: relative;
}

.event:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 30px;
  top: 40px;
  bottom: -6px;
  width: 1px;
  background: var(--color-border);
}

.event-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.tone-success { background: var(--color-success-soft); color: var(--color-success); }
.tone-danger { background: var(--color-danger-soft); color: var(--color-danger); }
.tone-info { background: var(--color-primary-soft); color: var(--color-primary); }
.tone-warning { background: var(--color-warning-soft); color: var(--color-warning); }
.tone-violet { background: var(--color-violet-soft); color: var(--color-violet); }
.tone-muted { background: var(--color-neutral-soft); color: var(--color-text-muted); }

.event-main {
  flex: 1;
  min-width: 0;
}

.event-line {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.event-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 3px;
  flex-wrap: wrap;
}

.event-meta .person {
  gap: 6px;
}

.link-btn {
  border: none;
  background: none;
  color: var(--color-primary);
  font-size: 12px;
  cursor: pointer;
  min-height: 24px; /* цель нажатия не ниже 24 px (WCAG 2.5.8); строка 12 px даёт с полями 4 px только 23 */
  padding: 4px 0;
}

@media (pointer: coarse) {
  .link-btn {
    padding: 10px 0;
  }
}

.diff {
  margin-top: 8px;
  border-collapse: collapse;
  font-size: 12px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.diff td {
  padding: 4px 10px;
  vertical-align: middle;
}

.before {
  color: var(--color-danger-dark);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--color-danger) 40%, transparent);
}

.after {
  color: var(--color-success-dark);
  font-weight: 600;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
}
</style>
