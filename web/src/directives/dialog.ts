// v-dialog="close": поведение модального окна для элемента с role="dialog" (v0.5.0, аудит доступности).
// - фокус при открытии — [autofocus], иначе первое поле, иначе первая кнопка действий («Отмена»):
//   раньше фокус оставался на кнопке под затемнением, и Enter нажимал её повторно;
// - имя окна — его заголовок (.modal-title) через aria-labelledby;
// - Esc закрывает верхнее окно, где бы ни был фокус; Tab не выходит за пределы окна;
// - после закрытия фокус возвращается туда, откуда окно открыли.
import type { Directive } from 'vue';

interface Entry { el: HTMLElement; close: () => void; returnTo: Element | null }
const stack: Entry[] = [];
let seq = 0;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
}

function onKey(e: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    top.close();
    return;
  }
  if (e.key !== 'Tab') return;
  const items = focusables(top.el);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  const inside = top.el.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
}

export const vDialog: Directive<HTMLElement, () => void> = {
  mounted(el, binding) {
    if (!stack.length) document.addEventListener('keydown', onKey);
    stack.push({ el, close: () => binding.value(), returnTo: document.activeElement });
    const title = el.querySelector<HTMLElement>('.modal-title');
    if (title && !el.hasAttribute('aria-labelledby') && !el.hasAttribute('aria-label')) {
      title.id ||= `dialog-title-${++seq}`;
      el.setAttribute('aria-labelledby', title.id);
    }
    const target = el.querySelector<HTMLElement>('[autofocus]')
      ?? el.querySelector<HTMLElement>('.modal-body input:not([type=hidden]):not([disabled]), .modal-body select, .modal-body textarea')
      ?? el.querySelector<HTMLElement>('.modal-actions button:not([disabled])')
      ?? focusables(el)[0];
    target?.focus();
  },
  updated(el, binding) {
    const entry = stack.find((s) => s.el === el);
    if (entry) entry.close = () => binding.value();
  },
  beforeUnmount(el) {
    const i = stack.findIndex((s) => s.el === el);
    if (i < 0) return;
    const [entry] = stack.splice(i, 1);
    if (!stack.length) document.removeEventListener('keydown', onKey);
    if (entry.returnTo instanceof HTMLElement && document.contains(entry.returnTo)) entry.returnTo.focus();
  },
};
