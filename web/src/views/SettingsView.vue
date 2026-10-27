<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type OrgSettings } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const settings = ref<OrgSettings | null>(null);
const error = ref('');
const saved = ref(false);

// смена своего пароля
const oldPassword = ref('');
const newPassword = ref('');
const pwMessage = ref('');

async function loadSettings(): Promise<void> {
  settings.value = await api.get<OrgSettings>('/settings');
}

async function saveSettings(): Promise<void> {
  if (!settings.value) return;
  error.value = '';
  try {
    settings.value = await api.patch<OrgSettings>('/settings', {
      conflictThreshold: settings.value.conflictThreshold,
      limitPolicy: settings.value.limitPolicy,
    });
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 2000);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function changePassword(): Promise<void> {
  pwMessage.value = '';
  try {
    await api.put(`/employees/${auth.me!.employee.id}/password`, {
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    });
    pwMessage.value = 'Пароль изменён. Войдите с новым паролем.';
    oldPassword.value = '';
    newPassword.value = '';
  } catch (e) {
    pwMessage.value = (e as Error).message;
  }
}

onMounted(loadSettings);
</script>

<template>
  <div>
    <div class="view-header">
      <div>
        <div class="view-title">Настройки</div>
        <div class="view-subtitle">Профиль, пароль{{ auth.isAdmin ? ', организация' : '' }}</div>
      </div>
    </div>

    <div class="settings-grid">
      <div class="card">
        <div class="card-pad"><strong>Мой профиль</strong></div>
        <div class="card-pad profile-lines">
          <div><span class="muted">ФИО:</span> {{ auth.me?.employee.name }}</div>
          <div><span class="muted">Логин:</span> <code>{{ auth.me?.employee.login }}</code></div>
          <div><span class="muted">Должность:</span> {{ auth.me?.employee.position ?? '—' }}</div>
          <div><span class="muted">Плановых дней:</span> {{ auth.me?.employee.plannedDays }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-pad"><strong>Смена пароля</strong></div>
        <div class="card-pad">
          <div v-if="pwMessage" class="warn-banner" style="margin-bottom: 10px">{{ pwMessage }}</div>
          <div class="field">
            <label>Старый пароль</label>
            <input v-model="oldPassword" type="password" class="input" autocomplete="current-password" />
          </div>
          <div class="field">
            <label>Новый пароль (≥8 символов)</label>
            <input v-model="newPassword" type="password" class="input" autocomplete="new-password" />
          </div>
          <button class="btn btn-primary" :disabled="oldPassword.length < 1 || newPassword.length < 8" @click="changePassword">
            Сменить пароль
          </button>
        </div>
      </div>

      <div v-if="auth.isAdmin && settings" class="card">
        <div class="card-pad"><strong>Организация</strong></div>
        <div class="card-pad">
          <div v-if="error" class="error-banner">{{ error }}</div>
          <div class="field">
            <label>Порог конфликта отсутствия в отделе: {{ settings.conflictThreshold }}%</label>
            <input v-model.number="settings.conflictThreshold" type="range" min="20" max="80" step="5" style="width: 100%" />
          </div>
          <div class="field">
            <label>Политика лимита дней</label>
            <select v-model="settings.limitPolicy" class="input">
              <option value="hard">Жёсткая — заявки сверх остатка блокируются</option>
              <option value="soft">Мягкая — только предупреждение</option>
            </select>
          </div>
          <button class="btn btn-primary" @click="saveSettings">{{ saved ? 'Сохранено ✓' : 'Сохранить' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
  align-items: start;
}
.card-pad { padding: 12px; border-bottom: 1px solid var(--color-border); }
.card-pad:last-child { border-bottom: none; }
.profile-lines { display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; }
.muted { color: var(--color-text-muted); }
</style>
