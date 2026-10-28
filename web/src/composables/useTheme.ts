// Тема: светлая, тёмная или как в системе (по умолчанию). Выбор хранится локально.
import { ref } from 'vue';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'vp.theme';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const choice = ref<ThemeChoice>(readChoice());
const effective = ref<'light' | 'dark'>('light');

function apply(): void {
  effective.value = choice.value === 'system' ? (media?.matches ? 'dark' : 'light') : choice.value;
  document.documentElement.dataset.theme = effective.value;
}

media?.addEventListener('change', () => { if (choice.value === 'system') apply(); });

export function initTheme(): void {
  apply();
}

export function useTheme() {
  function set(next: ThemeChoice): void {
    choice.value = next;
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch { /* приватный режим */ }
    apply();
  }
  /** Цикл для кнопки в верхней панели: система → светлая → тёмная. */
  function cycle(): void {
    set(choice.value === 'system' ? 'light' : choice.value === 'light' ? 'dark' : 'system');
  }
  return { choice, effective, set, cycle };
}
