<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();

const login = ref('');
const password = ref('');
const remember = ref(true);
const error = ref('');
const busy = ref(false);

async function submit(): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    await auth.login(login.value.trim(), password.value);
    router.push('/schedule');
  } catch (e) {
    error.value = (e as Error).message || 'Неверный логин или пароль';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-card card">
    <div class="login-logo"><span class="logo-dot">VP</span></div>
    <h1 class="login-title">Планировщик отпусков</h1>
    <p class="login-hint">Введите корпоративный логин и пароль</p>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <form @submit.prevent="submit">
      <div class="field">
        <label for="login">Логин</label>
        <input id="login" v-model="login" class="input" autocomplete="username" autofocus />
      </div>
      <div class="field">
        <label for="password">Пароль</label>
        <input id="password" v-model="password" type="password" class="input" autocomplete="current-password" />
      </div>
      <label class="remember">
        <input v-model="remember" type="checkbox" /> Запомнить меня
      </label>
      <button class="btn btn-primary login-btn" type="submit" :disabled="busy || !login || !password">
        {{ busy ? 'Входим…' : 'Войти' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login-card {
  width: 360px;
  padding: 28px;
}

.login-logo {
  display: flex;
  margin-bottom: 12px;
}

.login-logo .logo-dot {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--color-primary);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.login-title {
  font-size: 19px;
  margin-bottom: 4px;
}

.login-hint {
  color: var(--color-text-muted);
  font-size: 13px;
  margin: 0 0 18px;
}

.remember {
  display: flex;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-muted);
  margin-bottom: 16px;
}

.login-btn {
  width: 100%;
  justify-content: center;
  padding: 10px;
  font-size: 14px;
}
</style>
