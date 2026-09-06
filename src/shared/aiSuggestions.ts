/**
 * AI 建议表读写：AI 分析结果先作为“建议”（pending）保存，
 * 用户接受 → 升级为全局词表 taught；忽略 → 标记 ignored 不再展示。
 */
import { STORAGE_KEYS } from './storage';
import type { AiSuggestion, AiSuggestionStatus } from './types';

function newId(): string {
  return `ai-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function readAll(): Promise<AiSuggestion[]> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.aiSuggestions);
  const raw = got[STORAGE_KEYS.aiSuggestions];
  return Array.isArray(raw) ? (raw as AiSuggestion[]) : [];
}

async function persist(list: AiSuggestion[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.aiSuggestions]: list });
}

export async function listAiSuggestions(
  status?: AiSuggestionStatus,
): Promise<AiSuggestion[]> {
  const all = await readAll();
  return status ? all.filter((s) => s.status === status) : all;
}

/** 追加多条建议（新->旧在前） */
export async function addAiSuggestions(
  items: Omit<AiSuggestion, 'id' | 'createdAt' | 'status'>[],
): Promise<AiSuggestion[]> {
  const now = Date.now();
  const created: AiSuggestion[] = items.map((i) => ({
    ...i,
    id: newId(),
    createdAt: now,
    status: 'pending',
  }));
  const all = await readAll();
  const next = [...created, ...all];
  await persist(next);
  return created;
}

export async function setAiStatus(
  id: string,
  status: AiSuggestionStatus,
): Promise<void> {
  const all = await readAll();
  const s = all.find((x) => x.id === id);
  if (!s) return;
  s.status = status;
  await persist(all);
}

export async function removeAiSuggestion(id: string): Promise<void> {
  const all = await readAll();
  await persist(all.filter((x) => x.id !== id));
}
