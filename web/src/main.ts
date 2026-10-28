import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { initTheme } from './composables/useTheme';
import './styles/tokens.css';
import './styles/base.css';

initTheme(); // до монтирования — без вспышки светлой темы
createApp(App).use(createPinia()).use(router).mount('#app');
