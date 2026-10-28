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
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include' });

  if (res.status === 401 && retry && !path.startsWith('/auth/login') && (await refreshAccess())) {
    return request<T>(path, init, false);
  }

  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await toError(res);
  return (await res.json().catch(() => null)) as T;
}

/** Файл (выгрузки XLSX): тот же Bearer и автообновление токена, ответ — Blob. */
async function download(path: string, retry = true): Promise<Blob> {
  const headers: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const res = await fetch(`/api/v1${path}`, { headers, credentials: 'include' });
  if (res.status === 401 && retry && (await refreshAccess())) return download(path, false);
  if (!res.ok) throw await toError(res);
  return res.blob();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  download,
};

// ── Типы ответов (по contracts/openapi-vacation-api-v1.yaml) ──
export interface Me {
  employee: {
    id: number; name: string; login: string; position: string | null;
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
  deptId: number | null; deptName?: string | null; role: string; isAdmin: boolean; isHr: boolean;
  empType: string; managerId: number | null; projectId: number | null;
  plannedDays: number; carryOver: number; isActive: boolean;
}

export interface Page<T> {
  items: T[];
  meta: { page: number; perPage: number; total: number };
}

export interface VacationRequest {
  id: number; employee: number; employeeName?: string;
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
