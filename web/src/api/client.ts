// Единственный модуль, знающий про fetch (правило AGENTS.md).
// Access-токен — в памяти; автообновление по 401 через refresh-cookie.

let accessToken: string | null = null;

export function setAccess(token: string | null, exp?: string): void {
  void exp; // момент истечения проверяет сервер; клиент обновляет по 401
  accessToken = token;
}

export function hasAccess(): boolean {
  return accessToken !== null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let sessionLost: (() => void) | null = null;

/**
 * Сеанс потерян: access-токен отклонён, а обновить его не удалось — пароль сменён, сотрудник
 * уволен или истёк refresh. Без этого интерфейс оставался «вошедшим» и каждое действие
 * заканчивалось ошибкой (v0.5.0).
 */
export function onSessionLost(cb: () => void): void {
  sessionLost = cb;
}

/** 401 после неудачного обновления: сеанс был (токен в памяти) — значит, он потерян. */
function lost(): void {
  if (accessToken) sessionLost?.();
}

// Один refresh на всех: параллельные запросы с истёкшим токеном ждут общий результат.
// Иначе ротация отзывает refresh-токен первого запроса и остальные получают 401.
let refreshing: Promise<boolean> | null = null;

function refreshAccess(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return false;
      const data = await res.json();
      setAccess(data.accessToken, data.expiresAt);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  const code = String(body?.type ?? '').split('/problems/')[1] ?? 'internal';
  return new ApiError(res.status, code, body?.detail ?? body?.title ?? `Ошибка ${res.status}`);
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {
    // FormData: тип с границей частей выставляет браузер
    ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include' });

  if (res.status === 401 && retry && !path.startsWith('/auth/login')) {
    if (await refreshAccess()) return request<T>(path, init, false);
    lost();
  }

  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await toError(res);
  return (await res.json().catch(() => null)) as T;
}

/** Файл (выгрузки XLSX): тот же Bearer и автообновление токена, ответ — Blob. */
async function download(path: string, retry = true): Promise<Blob> {
  const headers: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const res = await fetch(`/api/v1${path}`, { headers, credentials: 'include' });
  if (res.status === 401 && retry) {
    if (await refreshAccess()) return download(path, false);
    lost();
  }
  if (!res.ok) throw await toError(res);
  return res.blob();
}

export interface LiveHandlers {
  hello?: (data: { unread: number; version: string }) => void;
  notifications?: (data: { unread: number }) => void;
  data?: (data: { version: string }) => void;
  /** Поток доступен (true) или потерян (false) — для резервного опроса. */
  status?: (live: boolean) => void;
}

/**
 * Поток событий сервера (SSE): билет на 60 секунд → EventSource. При обрыве — новый билет
 * и переподключение с нарастающей паузой; пока потока нет, вызывающий опрашивает сам.
 * Возвращает функцию отключения.
 */
export function subscribeLive(handlers: LiveHandlers): () => void {
  let source: EventSource | null = null;
  let stopped = false;
  let attempt = 0;
  let retry = 0;
  const open = async () => {
    if (stopped) return;
    try {
      const { ticket } = await request<{ ticket: string }>('/events/ticket', { method: 'POST' });
      if (stopped) return;
      source = new EventSource(`/api/v1/events?ticket=${encodeURIComponent(ticket)}`);
      const on = <T>(name: string, fn?: (d: T) => void) =>
        source!.addEventListener(name, (ev) => fn?.(JSON.parse((ev as MessageEvent).data) as T));
      on('hello', (d: { unread: number; version: string }) => { attempt = 0; handlers.status?.(true); handlers.hello?.(d); });
      on('notifications', handlers.notifications);
      on('data', handlers.data);
      // Билет одноразовый по смыслу (60 с): встроенный повтор EventSource с тем же адресом не годится
      source.onerror = () => { source?.close(); source = null; handlers.status?.(false); schedule(); };
    } catch {
      handlers.status?.(false);
      schedule();
    }
  };
  const schedule = () => {
    if (stopped) return;
    attempt++;
    retry = window.setTimeout(() => void open(), Math.min(60_000, 2000 * 2 ** Math.min(attempt, 5)));
  };
  void open();
  return () => { stopped = true; window.clearTimeout(retry); source?.close(); };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  /** Загрузка файла (multipart/form-data, поле file). */
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>(path, { method: 'POST', body: form });
  },
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  download,
};

// ── Типы ответов (по contracts/openapi-vacation-api-v1.yaml) ──
export interface Me {
  employee: {
    id: number; name: string; login: string; email: string | null; emailNotifications: boolean; position: string | null;
    deptId: number | null; projectId: number | null; managerId: number | null;
    role: string; isAdmin: boolean; isHr: boolean; empType: string;
    plannedDays: number; carryOver: number;
  };
  permissions: {
    approveSubordinates: number[]; isAdmin: boolean; isHr: boolean;
    /** Сотрудники, импорт, календарь, выгрузки, аудит: администратор или кадровая служба. */
    manageStaff: boolean; manageDirectories: boolean;
    /** Настройки организации: только администратор. */
    manageSettings: boolean;
  };
}

export interface Employee {
  id: number; login: string; name: string; position: string | null;
  email: string | null; deptId: number | null; deptName?: string | null; role: string; isAdmin: boolean; isHr: boolean;
  empType: string; managerId: number | null; projectId: number | null;
  plannedDays: number; carryOver: number; isActive: boolean;
}

export type ImportAction = 'create' | 'update' | 'unchanged' | 'error';

export interface ImportResult {
  applied: boolean;
  summary: Record<ImportAction, number>;
  newDepartments: string[];
  rows: Array<{
    line: number; action: ImportAction; name: string; login: string; employeeId?: number;
    changes: Record<string, { before: unknown; after: unknown }>; errors: string[];
  }>;
  /** Одноразовые пароли созданных сотрудников — только в ответе применения. */
  credentials: Array<{ login: string; name: string; password: string }>;
}

export interface Page<T> {
  items: T[];
  meta: { page: number; perPage: number; total: number };
}

export interface VacationRequest {
  id: number; employee: number; employeeName?: string; employeeDept?: string | null;
  start: string; end: string; type: 'vacation' | 'maternity';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  pendingDeletion: boolean;
  changeFrom: { start: string; end: string } | null;
  comment: string | null; rejectionComment: string | null;
  createdAt: string; updatedAt: string;
  history?: Array<{ ts: string; actor: number | null; action: string; comment: string | null }>;
}

export interface Balance {
  year: number; entitlement: number; used: number; pending: number;
  remaining: number; hasFourteenDayStretch: boolean;
}

export interface ScheduleEmployee {
  id: number; name: string; position: string | null; dept: string | null;
  vacations: Array<{ requestId: number; start: string; end: string; type: string; status: string }>;
  workPattern: Record<string, string>;
  workOverrides: Array<{ date: string; mode: string }>;
}

export interface Schedule {
  from: string; to: string;
  employees: ScheduleEmployee[];
  conflicts: Array<{ date: string; dept: string; absentRatio: number }>;
}

export interface Department {
  id: number; name: string; managerId: number | null; headcount: number;
}

export interface OrgSettings {
  conflictThreshold: number; timezone: string;
  limitPolicy: 'hard' | 'soft'; defaultPlannedDays: number;
  /** Почта настроена на сервере (SMTP_HOST). */
  mailEnabled?: boolean;
}

export interface Notification {
  id: number; kind: string; text: string; isRead: boolean; createdAt: string;
}

export interface AuditEvent {
  id: number; ts: string; actorId: number | null; actorName?: string | null;
  action: string; entity: string; entityId: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
}

// ── Аналитика (с v0.3.0) ──
export interface Insight { severity: 'danger' | 'warning' | 'info' | 'success'; title: string; text: string }

export interface DepartmentOverview {
  dept: string; year: number; threshold: number; headcount: number;
  months: Array<{ month: number; avgRatio: number; planRatio: number; peakRatio: number; peakDate: string | null }>;
  conflicts: Array<{ start: string; end: string; peakRatio: number; peakAbsent: number; names: string[] }>;
  planning: Array<{ id: number; name: string; available: number; planned: number; hasStretch: boolean }>;
  insights: Insight[];
}

export type DayStatus = 'vacation' | 'office' | 'remote' | 'off';

export interface TeamSnapshot {
  date: string; threshold: number; headcount: number; absentRatio: number; overThreshold: boolean;
  counts: Record<DayStatus | 'pending', number>;
  members: Array<{
    id: number; name: string; dept: string | null; empType: string; status: DayStatus; until: string | null;
    next: { start: string; end: string } | null; available: number; hasStretch: boolean; pending: number;
  }>;
}

export interface Suggestion {
  start: string; end: string; vacationDays: number; calendarDays: number; holidays: number;
  maxRatio: number; avgRatio: number; overlapWith: string[]; score: number; reasons: string[];
}

export interface Suggestions {
  employee: number; length: number; available: number; hasStretch: boolean; threshold: number; items: Suggestion[];
}

export interface WorkSchedule {
  employee: number;
  pattern: Record<string, 'office' | 'remote' | 'off'>;
  overrides: Array<{ date: string; mode: 'office' | 'remote' | 'off' }>;
}
