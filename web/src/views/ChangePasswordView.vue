<script setup lang="ts">
// Смена пароля, выданного кадровой службой (v0.6.0, E62-04): до смены остальной интерфейс недоступен —
// сервер отвечает на всё, кроме профиля и смены пароля, кодом auth/password-change-required.
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { api, ApiError } from '@/api/client';
import AppIcon from '@/components/common/AppIcon.vue';

const auth = useAuthStore();
const router = useRouter();

const current = ref('');
const next = ref('');
const repeat = ref('');
const show = ref(false);
const minLength = ref(8);
const error = ref('');
const busy = ref(false);

onMounted(async () => {
  try {
    minLength.value = (await api.get<{ minLength: number }>('/auth/password-policy')).minLength;
  } catch { /* подсказка с длиной по умолчанию; сервер всё равно проверит */ }
});

async function submit(): Promise<void> {
  error.value = '';
  if (next.value !== repeat.value) {
    error.value = 'Новый пароль и повтор не совпадают.';
    return;
  }
  busy.value = true;
  try {
    await api.post('/auth/password', { oldPassword: current.value, newPassword: next.value });
    // Смена пароля завершает все сеансы — входим заново уже со своим паролем
    auth.drop();
    await router.push({ path: '/login', query: { changed: '1' } });
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 401
      ? 'Текущий пароль неверен — введите пароль, который выдала кадровая служба.'
      : e instanceof ApiError ? e.message : 'Нет связи с сервером. Проверьте подключение и попробуйте снова.';
  } finally {
    busy.value = false;
  }
}

async function logout(): Promise<void> {
  await auth.logout();
  await router.push('/login');
}
</script>

<template>
  <div class="change-page">
    <form
      class="change-card"
      @submit.prevent="submit"
    >
      <AppIcon
        name="key"
        :size="32"
        class="change-icon"
      />
      <h1 class="change-title">
        Придумайте свой пароль
      </h1>
      <p class="change-hint">
        Пароль выдала кадровая служба — он действует только для первого входа.
        Новый пароль: не короче {{ minLength }} символов, без логина и фамилии, не из распространённых вроде «qwerty123».
      </p>

      <div
        v-if="error"
        class="banner banner-error"
        role="alert"
      >
        <AppIcon
          name="warning"
          :size="15"
        />
        <span>{{ error }}</span>
      </div>

      <input
        type="text"
        class="sr-only"
        autocomplete="username"
        :value="auth.me?.employee.login"
        tabindex="-1"
        aria-hidden="true"
        readonly
      >
      <div class="field">
        <label for="cp-current">Пароль от кадровой службы</label>
        <input
          id="cp-current"
          v-model="current"
          class="input"
          :type="show ? 'text' : 'password'"
          autocomplete="current-password"
          autofocus
          required
        >
      </div>
      <div class="field">
        <label for="cp-next">Новый пароль</label>
        <input
          id="cp-next"
          v-model="next"
          class="input"
          :type="show ? 'text' : 'password'"
          autocomplete="new-password"
          :minlength="minLength"
          required
        >
      </div>
      <div class="field">
        <label for="cp-repeat">Повторите новый пароль</label>
        <input
          id="cp-repeat"
          v-model="repeat"
          class="input"
          :type="show ? 'text' : 'password'"
          autocomplete="new-password"
          required
        >
      </div>
      <label class="check">
        <input
          v-model="show"
          type="checkbox"
        > Показать пароли
      </label>

      <button
        class="btn btn-primary btn-block"
        type="submit"
        :disabled="busy"
      >
        Сохранить пароль
      </button>
      <button
        class="btn btn-ghost btn-block"
        type="button"
        @click="logout"
      >
        Выйти
      </button>
    </form>
  </div>
</template>

<style scoped>
.change-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  background: var(--color-bg);
}

.change-card {
  width: 100%;
  max-width: 400px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-2);
  padding: 28px;
}

.change-icon {
  color: var(--color-primary);
}

.change-title {
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.01em;
  margin-top: 12px;
}

.change-hint {
  color: var(--color-text-muted);
  font-size: 13.5px;
  margin: 6px 0 20px;
  line-height: 1.5;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 4px 0 16px;
  min-height: 24px;
}

.btn-block + .btn-block {
  margin-top: 8px;
}
</style>
