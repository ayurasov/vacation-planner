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
    /** Идентификатор запроса из ответа (v1.0.0): по нему поддержка находит строку журнала сервера. */
    public readonly requestId?: string,
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
let refreshing: Promise<Refresh> | null = null;

/**
 * Итог обновления токена: `ok`; `denied` — refresh недействителен (выход, смена пароля, увольнение,
 * завершённый сеанс), сеанс потерян; ApiError — сервер перегружен, перезапускается или недоступен.
 * Во втором случае сеанс жив: до v1.0.0 любой неуспех считался потерей сеанса, и при перезапуске
 * PostgreSQL или перегрузке (503) сотрудников выбрасывало на экран входа.
 */
type Refresh = 'ok' | 'denied' | ApiError;

function refreshAccess(): Promise<Refresh> {
  refreshing ??= (async (): Promise<Refresh> => {
    try {
      const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      if (res.status === 401 || res.status === 403) return 'denied';
      if (!res.ok) return await toError(res);
      const data = await res.json();
      setAccess(data.accessToken, data.expiresAt);
      return 'ok';
    } catch {
      return new ApiError(503, 'service-unavailable', 'Сервер недоступен. Проверьте подключение и повторите через несколько секунд.');
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  const code = String(body?.type ?? '').split('/problems/')[1] ?? 'internal';
  const requestId = body?.requestId ?? res.headers.get('X-Request-Id') ?? undefined;
  return new ApiError(res.status, code, body?.detail ?? body?.title ?? `Ошибка ${res.status}`, requestId);
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
    const refreshed = await refreshAccess();
    if (refreshed === 'ok') return request<T>(path, init, false);
    if (refreshed !== 'denied') throw refreshed;
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
    const refreshed = await refreshAccess();
    if (refreshed === 'ok') return download(path, false);
    if (refreshed !== 'denied') throw refreshed;
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
      // Сервер раз в 10 с сверяет версию пароля и активность: сеанс отозван — сразу на вход,
      // не дожидаясь повторного подключения и отказа в билете
      on('revoked', () => { stopped = true; source?.close(); source = null; lost(); });
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
  /** Восстановить сеанс по refresh-cookie при запуске: без заведомого 401 на /auth/me до обновления. */
  restore: async (): Promise<boolean> => (await refreshAccess()) === 'ok',
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
    /** Пароль выдан кадровой службой: до смены доступны только профиль и смена пароля (v0.6.0). */
    mustChangePassword?: boolean;
  };
  permissions: {
    approveSubordinates: number[]; isAdmin: boolean; isHr: boolean;
    /** Есть что согласовывать: команда, замещение руководителя, эскалированные заявки (v0.6.0). */
    approvals?: boolean;
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
  /** Табельный номер — графа 4 формы Т-7 (v0.6.0). */
  personnelNumber?: string | null;
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
  /** Эскалация (v0.6.0): с какого момента ждёт решения, кому и когда передана. */
  pendingSince?: string | null; escalatedTo?: number | null; escalatedAt?: string | null;
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
  id: number; name: string; managerId: number | null; managerName?: string | null; headcount: number;
}

export interface OrgSettings {
  conflictThreshold: number; timezone: string;
  limitPolicy: 'hard' | 'soft'; defaultPlannedDays: number;
  /** Безопасность (v0.6.0): политика паролей, блокировка после неудачных попыток, журнал входов. */
  passwordMinLength: number; lockoutThreshold: number; lockoutMinutes: number; loginRetentionDays: number;
  /** Дней без решения до передачи заявки вышестоящему; 0 — не передаётся (v0.6.0). */
  escalationDays: number;
  /** За сколько дней до начала отпуска извещать; не меньше 14 — ст. 123 ТК РФ (v0.6.0). */
  noticeDays: number;
  /** Реквизиты и подписанты формы Т-7 (v0.6.0). */
  orgName: string | null; orgOkpo: string | null; headPosition: string | null; headName: string | null;
  hrHeadPosition: string | null; hrHeadName: string | null;
  /** Почта настроена на сервере (SMTP_HOST). */
  mailEnabled?: boolean;
}

// ── Кампания планирования и утверждение графика (с v0.6.0) ──
export type PlanStatus = 'none' | 'partial' | 'done';

export interface EmployeePlan {
  id: number; name: string; position: string | null; deptId: number | null; dept: string | null; personnelNumber: string | null;
  norm: number; plannedDays: number; approvedDays: number; pendingDays: number; parts: number; hasFourteen: boolean;
  status: PlanStatus;
}

export interface PlanningProgress {
  employees: number; planned: number; done: number; withFourteen: number; plannedDays: number; normDays: number;
}

export interface PlanningOverview {
  year: number;
  campaign: {
    year: number; deadline: string; open: boolean; openedAt: string; openedBy: string | null;
    closedAt: string | null; remindedAt: string | null;
  } | null;
  approval: {
    year: number; docNumber: string; docDate: string; unionOpinionDate: string | null; unionOpinionNumber: string | null;
    approvedAt: string; approvedBy: string | null; rows: number;
  } | null;
  /** Согласованных отпусков года — столько строк войдёт в график при утверждении сейчас. */
  approvedParts: number;
  totals: PlanningProgress;
  departments: Array<PlanningProgress & { deptId: number | null; dept: string | null }>;
  warnings: { pendingRequests: number; missingPersonnelNumbers: number; missingRequisites: string[] };
}

export interface MyPlanning {
  campaign: { year: number; deadline: string; overdue: boolean } | null;
  plan: EmployeePlan | null;
}

// ── Извещение о начале отпуска (с v0.6.0) ──
export interface VacationNotice {
  id: number; requestId: number; employeeId: number; employeeName: string; position: string | null; dept: string | null;
  start: string; end: string; days: number; sentAt: string;
  /** Извещён позже чем за две недели — вправе попросить перенос (ст. 124). */
  late: boolean;
  acknowledgedAt: string | null;
  /** Отпуск отменён или перенесён на другие даты. */
  withdrawnAt: string | null;
  /** Не подтверждено, а до начала три дня и меньше. */
  overdue: boolean;
}

// ── Замещение руководителя (с v0.6.0) ──
export interface Delegation {
  id: number; managerId: number; managerName: string; deputyId: number; deputyName: string;
  start: string; end: string; active: boolean; createdBy: number | null; createdAt: string;
}

// ── Безопасность (с v0.6.0) ──
export interface UserSession {
  id: string; current: boolean; method: 'password' | 'oidc';
  startedAt: string; lastActiveAt: string; ip: string | null; device: string;
}

export type LoginResult =
  | 'success' | 'bad_password' | 'unknown_login' | 'locked' | 'rate_limited' | 'password_disabled'
  | 'sso_success' | 'sso_unknown' | 'refresh_reuse';

export interface LoginEvent {
  id: number; ts: string; employeeId: number | null; employeeName: string | null;
  login: string; result: LoginResult; method: 'password' | 'oidc' | 'refresh'; ip: string | null; device: string;
}

export interface AccountSecurity {
  lastLoginAt: string | null; lockedUntil: string | null; failedLogins: number;
  mustChangePassword: boolean; passwordChangedAt: string | null; activeSessions: number;
  sessions: UserSession[];
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
