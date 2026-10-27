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

async function refreshAccess(): Promise<boolean> {
  const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!res.ok) return false;
  const data = await res.json();
  setAccess(data.accessToken, data.expiresAt);
  return true;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include' });

  if (res.status === 401 && retry && path !== '/auth/login') {
    const body = await res.clone().json().catch(() => null);
    if (body?.type?.endsWith('auth/token-expired') || res.status === 401) {
      if (await refreshAccess()) return request<T>(path, init, false);
    }
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = String(body?.type ?? '').split('/problems/')[1] ?? 'internal';
    throw new ApiError(res.status, code, body?.detail ?? body?.title ?? `Ошибка ${res.status}`);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ── Типы ответов (по contracts/openapi-vacation-api-v1.yaml) ──
export interface Me {
  employee: {
    id: number; name: string; login: string; position: string | null;
    deptId: number | null; projectId: number | null; managerId: number | null;
    role: string; isAdmin: boolean; empType: string;
    plannedDays: number; carryOver: number;
  };
  permissions: { approveSubordinates: number[]; isAdmin: boolean; manageDirectories: boolean };
}

export interface Employee {
  id: number; login: string; name: string; position: string | null;
  deptId: number | null; deptName?: string | null; role: string; isAdmin: boolean;
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
  name: string; managerId: number | null; headcount: number;
}

export interface OrgSettings {
  conflictThreshold: number; timezone: string;
  limitPolicy: 'hard' | 'soft'; defaultPlannedDays: number;
}

export interface Notification {
  id: number; kind: string; text: string; isRead: boolean; createdAt: string;
}

export function daysBetween(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

export function fmtRange(start: string, end: string): string {
  const [sy, sm, sd] = start.split('-');
  const [ey, em, ed] = end.split('-');
  if (sy === ey && sm === em) return `${+sd}–${+ed}.${sm}.${sy}`;
  if (sy === ey) return `${+sd}.${sm} – ${+ed}.${em}.${sy}`;
  return `${+sd}.${sm}.${sy} – ${+ed}.${em}.${ey}`;
}
