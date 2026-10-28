<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { api, ApiError } from '@/api/client';
import AppIcon from '@/components/common/AppIcon.vue';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

// Единый вход: кнопка провайдера; вход по паролю может быть оставлен только администраторам
const sso = ref<{ enabled: boolean; label: string; localLogin: boolean } | null>(null);
const showLocal = ref(false);
const passwordForm = computed(() => !sso.value?.enabled || sso.value.localLogin || showLocal.value);

const SSO_ERRORS: Record<string, string> = {
  cancelled: 'Вход через корпоративную учётную запись отменён.',
  expired: 'Время на вход истекло. Попробуйте ещё раз.',
  invalid: 'Не удалось подтвердить вход у провайдера. Попробуйте ещё раз или обратитесь к администратору.',
  unknown: 'Учётная запись не найдена в планировщике или отключена. Обратитесь в кадровую службу.',
  unavailable: 'Сервис единого входа недоступен. Попробуйте позже.',
  disabled: 'Единый вход не настроен.',
};

onMounted(async () => {
  const code = route.query.sso;
  if (typeof code === 'string') error.value = SSO_ERRORS[code] ?? SSO_ERRORS.invalid;
  try {
    sso.value = await api.get('/auth/oidc/config');
  } catch { /* без единого входа — только пароль */ }
});

const login = ref('');
const password = ref('');
const showPassword = ref(false);
const error = ref('');
const busy = ref(false);
const version = __APP_VERSION__;

const FEATURES = [
  { icon: 'schedule', title: 'График всей компании', text: 'Отпуска отделов на год, пересечения и конфликты — на одном экране.' },
  { icon: 'approvals', title: 'Согласование в один шаг', text: 'Руководитель видит заявку, конфликты отдела и решает сразу.' },
  { icon: 'vacation', title: 'Честный остаток дней', text: 'Праздники не съедают отпуск: расчёт по производственному календарю.' },
];

async function submit(): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    await auth.login(login.value.trim(), password.value);
    router.push('/schedule');
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 429
      ? 'Слишком много попыток входа. Подождите минуту и попробуйте снова.'
      : e instanceof ApiError && e.status === 403
        ? 'Вход по паролю отключён — войдите через корпоративную учётную запись.'
        : 'Неверный логин или пароль. Проверьте раскладку и Caps Lock.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <section class="login-brand">
      <div class="brand-inner">
        <div class="brand-row">
          <AppIcon
            name="brand"
            :size="44"
          />
          <div>
            <div class="brand-name">
              Планировщик отпусков
            </div>
            <div class="brand-tag">
              Корпоративный график отпусков и согласований
            </div>
          </div>
        </div>
        <h2 class="brand-headline">
          Отпуска команды — спокойно<br>и прозрачно
        </h2>
        <ul class="features">
          <li
            v-for="f in FEATURES"
            :key="f.title"
          >
            <span class="feature-icon"><AppIcon
              :name="f.icon"
              :size="18"
            /></span>
            <span>
              <strong>{{ f.title }}</strong>
              <span class="feature-text">{{ f.text }}</span>
            </span>
          </li>
        </ul>
      </div>
      <div class="brand-foot">
        Версия {{ version }} · © Alexander Yurasov
      </div>
    </section>

    <section class="login-form-wrap">
      <form
        class="login-form"
        @submit.prevent="submit"
      >
        <div class="mobile-brand">
          <AppIcon
            name="brand"
            :size="40"
          />
        </div>
        <h1 class="form-title">
          Вход
        </h1>
        <p class="form-hint">
          {{ sso?.enabled ? 'Корпоративная учётная запись — без отдельного пароля.' : 'Корпоративный логин и пароль. Нет доступа — обратитесь к администратору.' }}
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

        <template v-if="sso?.enabled">
          <a
            class="btn btn-primary btn-lg btn-block"
            href="/api/v1/auth/oidc/start"
          >
            <AppIcon
              name="shield"
              :size="16"
            /> Войти через {{ sso.label }}
          </a>
          <div
            v-if="passwordForm"
            class="divider"
          >
            <span>или по логину и паролю</span>
          </div>
          <button
            v-else
            class="btn btn-ghost btn-block admin-login"
            type="button"
            @click="showLocal = true"
          >
            Вход администратора по паролю
          </button>
        </template>

        <template v-if="passwordForm">
          <div class="field">
            <label for="login">Логин</label>
            <div class="input-icon">
              <AppIcon
                name="user"
                :size="15"
              />
              <input
                id="login"
                v-model="login"
                class="input input-lg"
                autocomplete="username"
                placeholder="ivanov.ii"
                autofocus
                required
              >
            </div>
          </div>
          <div class="field">
            <label for="password">Пароль</label>
            <div class="input-icon">
              <AppIcon
                name="key"
                :size="15"
              />
              <input
                id="password"
                v-model="password"
                class="input input-lg"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                required
              >
              <button
                type="button"
                class="reveal"
                :aria-label="showPassword ? 'Скрыть пароль' : 'Показать пароль'"
                @click="showPassword = !showPassword"
              >
                {{ showPassword ? 'Скрыть' : 'Показать' }}
              </button>
            </div>
          </div>
          <button
            class="btn btn-lg btn-block"
            :class="sso?.enabled ? '' : 'btn-primary'"
            type="submit"
            :disabled="busy || !login.trim() || !password"
          >
            {{ busy ? 'Входим…' : 'Войти' }}
            <AppIcon
              v-if="!busy"
              name="arrowRight"
              :size="15"
            />
          </button>
        </template>
        <p class="form-foot">
          Сеанс защищён: пароль хранится только в виде хеша, вход ограничен по частоте попыток.
        </p>
      </form>
    </section>
  </div>
</template>

<style scoped>
.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 18px 0 14px;
  color: var(--color-text-soft);
  font-size: 12px;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border);
}

.admin-login {
  margin-top: 10px;
}

.login-page {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(420px, 1.05fr) 1fr;
  background: var(--color-surface);
}

.login-brand {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 56px 64px 32px;
  background: linear-gradient(155deg, #f3f6ff 0%, #ffffff 45%, #eef3ff 100%);
  border-right: 1px solid var(--color-border);
}

[data-theme='dark'] .login-brand {
  background: linear-gradient(155deg, #141b2c 0%, #121620 45%, #131b30 100%);
}

.login-brand::before {
  content: '';
  position: absolute;
  right: -180px;
  top: -160px;
  width: 520px;
  height: 520px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(79, 124, 255, 0.22), rgba(79, 124, 255, 0) 70%);
}

.login-brand::after {
  content: '';
  position: absolute;
  left: -140px;
  bottom: -200px;
  width: 460px;
  height: 460px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(34, 160, 107, 0.14), rgba(34, 160, 107, 0) 70%);
}

.brand-inner {
  position: relative;
  z-index: 1;
  max-width: 520px;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-name {
  font-size: 19px;
  font-weight: 700;
}

.brand-tag {
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-top: 3px;
}

.brand-headline {
  font-size: 34px;
  line-height: 1.15;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 72px 0 32px;
}

.features {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.features li {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.features strong {
  display: block;
  font-size: 14px;
}

.feature-text {
  display: block;
  font-size: 13px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

.feature-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-1);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.brand-foot {
  position: relative;
  z-index: 1;
  font-size: 12px;
  color: var(--color-text-soft);
  border-top: 1px solid var(--color-border);
  padding-top: 14px;
}

.login-form-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
}

.login-form {
  width: 100%;
  max-width: 360px;
}

.mobile-brand {
  display: none;
  margin-bottom: 18px;
}

.form-title {
  font-size: 26px;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.form-hint {
  color: var(--color-text-muted);
  font-size: 13.5px;
  margin: 6px 0 24px;
}

.input-lg {
  padding-top: 10px;
  padding-bottom: 10px;
}

.reveal {
  position: absolute;
  right: 8px;
  border: none;
  background: none;
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
}

.reveal:hover {
  background: var(--color-primary-soft);
}

.btn-block {
  margin-top: 6px;
}

.form-foot {
  font-size: 12px;
  color: var(--color-text-soft);
  margin-top: 18px;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-brand {
    display: none;
  }

  .mobile-brand {
    display: block;
  }
}
</style>
