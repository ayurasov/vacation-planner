import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import './styles/tokens.css';
import './styles/base.css';

// Тема: светлая/тёмная, сохраняется локально
const saved = localStorage.getItem('vp.theme');
if (saved === 'dark' || saved === 'light') {
  document.documentElement.dataset.theme = saved;
}

createApp(App).use(createPinia()).use(router).mount('#app');
