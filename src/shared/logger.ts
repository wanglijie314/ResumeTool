/**
 * 本地运行日志（环形记录，写入 chrome.storage.local）。
 *
 * 为什么不用"普通磁盘文件"：扩展运行在浏览器沙箱里，无法直接往任意磁盘路径写文件，
 * chrome.storage.local 本身就是落在本机配置文件里的持久化存储。配合保留策略控制体积：
 *  - 只保留"最近 20 个会话"（每个页面/后台的一次启动 = 一个会话）；
 *  - 超过 1 天的会话/事件自动清理（每次写入时惰性执行，相当于一天多次检查）；
 *  - 单会话事件上限 200 条，防止异常循环刷爆。
 * 需要真正 .txt 文件时：options 页「运行日志」提供一键导出（保存到下载目录）。
 *
 * 所有日志同时镜像输出到 console（内容脚本的日志会显示在页面 DevTools，
 * 后台日志显示在 chrome://extensions 该扩展 "Service Worker" 的检查视图控制台）。
 */
import { STORAGE_KEYS } from './storage';
import type { LogEvent, LogSession } from './types';

const MAX_SESSIONS = 20;
const MAX_EVENTS_PER_SESSION = 200;
const RETENTION_MS = 24 * 60 * 60 * 1000; // 1 天

function tsId(ts: number, source: LogSession['source']): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${source}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${d.getMilliseconds()}`;
}

async function readRaw(): Promise<LogSession[]> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.logs);
  const v = got[STORAGE_KEYS.logs];
  return Array.isArray(v) ? (v as LogSession[]) : [];
}

/** 保留策略：1 天内 或 最新 20 个会话；每会话事件截断到最近 200 条 */
function prune(sessions: LogSession[]): LogSession[] {
  const now = Date.now();
  const cutoff = now - RETENTION_MS;
  const recent = [...sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_SESSIONS);
  const recentIds = new Set(recent.map((s) => s.id));
  const kept = sessions
    .filter((s) => s.startedAt >= cutoff || recentIds.has(s.id))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_SESSIONS);
  for (const s of kept) {
    if (s.events.length > MAX_EVENTS_PER_SESSION) {
      s.events = s.events.slice(-MAX_EVENTS_PER_SESSION);
    }
  }
  return kept;
}

async function persist(sessions: LogSession[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.logs]: prune(sessions) });
}

/** 返回全部会话（已按新->旧排序并应用保留策略） */
export async function listSessions(): Promise<LogSession[]> {
  const raw = await readRaw();
  return prune(raw);
}

/** 开启一个会话（页面内容脚本每次启动 / 后台事件需要时调用） */
export async function startSession(opts: {
  source: LogSession['source'];
  url?: string;
  title?: string;
}): Promise<string> {
  const session: LogSession = {
    id: tsId(Date.now(), opts.source),
    source: opts.source,
    startedAt: Date.now(),
    events: [],
  };
  if (opts.url) session.url = opts.url;
  if (opts.title) session.title = opts.title;
  const arr = await readRaw();
  arr.push(session);
  await persist(arr);
  return session.id;
}

export async function endSession(sessionId: string): Promise<void> {
  const arr = await readRaw();
  const s = arr.find((x) => x.id === sessionId);
  if (!s) return;
  s.endAt = Date.now();
  await persist(arr);
}

export async function appendEvent(
  sessionId: string,
  level: LogEvent['level'],
  msg: string,
  data?: unknown,
): Promise<void> {
  const arr = await readRaw();
  const s = arr.find((x) => x.id === sessionId);
  if (!s) return;
  const ev: LogEvent = { ts: Date.now(), level, msg };
  if (data !== undefined) ev.data = data;
  s.events.push(ev);
  await persist(arr);
  // 镜像到控制台，便于现场查看
  try {
    const line = `[简历一键填][${sessionId}] ${msg}`;
    const fn =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    fn(line, data !== undefined ? data : '');
  } catch {
    /* ignore */
  }
}

/** 清空全部日志（options 页按钮） */
export async function clearSessions(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.logs]: [] });
}

/** 导出为纯文本（options 页"导出"按钮使用） */
export function sessionsToText(sessions: LogSession[]): string {
  const lines: string[] = [];
  for (const s of sessions) {
    lines.push(
      `===== ${s.id} | ${s.source} | 开始 ${new Date(s.startedAt).toLocaleString()}${s.endAt ? ` | 结束 ${new Date(s.endAt).toLocaleString()}` : ''} | ${s.url ?? ''} ${s.title ?? ''} =====`,
    );
    for (const e of s.events) {
      const t = new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false });
      const d = e.data !== undefined ? ` | data=${JSON.stringify(e.data)}` : '';
      lines.push(`[${t}] [${e.level}] ${e.msg}${d}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
