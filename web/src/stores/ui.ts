// Тосты и диалог подтверждения вместо alert()/confirm() браузера.
import { defineStore } from 'pinia';

export interface Toast {
  id: number;
  text: string;
  tone: 'success' | 'error' | 'info';
}

export interface ConfirmRequest {
  title: string;
  text?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Обязательный комментарий (например, причина отклонения) — минимум символов. */
  commentMin?: number;
  commentLabel?: string;
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (value: { ok: boolean; comment: string }) => void;
}

let seq = 0;

export const useUiStore = defineStore('ui', {
  state: () => ({
    toasts: [] as Toast[],
    confirm: null as PendingConfirm | null,
  }),
  actions: {
    toast(text: string, tone: Toast['tone'] = 'success'): void {
      const id = ++seq;
      this.toasts.push({ id, text, tone });
      setTimeout(() => this.dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    error(e: unknown): void {
      this.toast(e instanceof Error ? e.message : String(e), 'error');
    },
    dismiss(id: number): void {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },
    ask(req: ConfirmRequest): Promise<{ ok: boolean; comment: string }> {
      return new Promise((resolve) => {
        this.confirm = { ...req, resolve };
      });
    },
    answer(ok: boolean, comment = ''): void {
      this.confirm?.resolve({ ok, comment });
      this.confirm = null;
    },
  },
});
