// Настройки почты — только из окружения (правило 6 AGENTS.md). Без SMTP_HOST письма не ставятся
// в очередь: стенд без почты работает как раньше, только с уведомлениями в интерфейсе.
export interface MailConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  appUrl: string;
  /** Период опроса очереди, секунд; 0 — фоновая отправка выключена (тесты, разовые задачи). */
  pollSeconds: number;
}

export function mailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const host = env.SMTP_HOST?.trim() ?? '';
  const secure = env.SMTP_SECURE === 'true';
  return {
    enabled: host.length > 0,
    host,
    port: Number(env.SMTP_PORT) || (secure ? 465 : 587),
    secure,
    user: env.SMTP_USER || undefined,
    password: env.SMTP_PASSWORD || undefined,
    from: env.MAIL_FROM || 'Планировщик отпусков <noreply@localhost>',
    appUrl: (env.APP_URL || 'http://localhost').replace(/\/+$/, ''),
    pollSeconds: env.MAIL_POLL_SECONDS === undefined ? 15 : Math.max(0, Number(env.MAIL_POLL_SECONDS) || 0),
  };
}
