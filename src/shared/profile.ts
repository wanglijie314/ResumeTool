/**
 * 信息副本（ProfileCopy）CRUD。
 * 所有写入都先读取 → 修改 → 整体写回（本地量小，简单可靠）。
 */
import { STORAGE_KEYS } from './storage';
import { customKeyOfName } from './keys';
import type { FieldKey } from './taxonomy';
import type { CustomFieldValue, ProfileCopy, ProfileEntry } from './types';

const clone = <T>(v: T): T => structuredClone(v);

async function readAll(): Promise<ProfileCopy[]> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.profileCopies);
  const v = got[STORAGE_KEYS.profileCopies];
  return Array.isArray(v) ? (v as ProfileCopy[]) : [];
}

async function writeAll(copies: ProfileCopy[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.profileCopies]: copies });
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function defaultOf(copies: ProfileCopy[]): ProfileCopy | undefined {
  return copies.find((c) => c.isDefault) ?? copies[0];
}

/** 读取全部副本（已按创建时间升序）；若一个都没有则自动建"默认副本" */
export async function listCopies(): Promise<ProfileCopy[]> {
  const raw = await readAll();
  // 兼容旧数据：补 blocks / custom 空数组
  const copies = raw.map((c) => ({
    ...c,
    blocks: Array.isArray(c.blocks) ? c.blocks : [],
    custom: Array.isArray(c.custom) ? c.custom : [],
  }));
  if (copies.length === 0) {
    const first: ProfileCopy = {
      id: newId('copy'),
      name: '默认副本',
      isDefault: true,
      entries: [],
      blocks: [],
      custom: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await writeAll([first]);
    return [first];
  }
  // 保证有且仅有一个默认
  if (!copies.some((c) => c.isDefault)) {
    copies[0]!.isDefault = true;
    await writeAll(copies);
  }
  return copies;
}

export async function getDefaultCopy(): Promise<ProfileCopy | undefined> {
  return defaultOf(await listCopies());
}

export async function createCopy(name: string, fromId?: string): Promise<ProfileCopy> {
  const copies = await listCopies();
  const from = fromId ? copies.find((c) => c.id === fromId) : undefined;
  const created: ProfileCopy = {
    id: newId('copy'),
    name: name.trim() || `副本 ${copies.length + 1}`,
    isDefault: false,
    entries: from ? clone(from.entries) : [],
    blocks: from ? clone(from.blocks) : [],
    custom: from ? clone(from.custom ?? []) : [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  copies.push(created);
  await writeAll(copies);
  return created;
}

export async function renameCopy(id: string, name: string): Promise<void> {
  const copies = await listCopies();
  const c = copies.find((x) => x.id === id);
  if (c) {
    c.name = name.trim() || c.name;
    c.updatedAt = Date.now();
    await writeAll(copies);
  }
}

/** 切换默认副本（同一时刻只有一份 isDefault=true） */
export async function setDefaultCopy(id: string): Promise<void> {
  const copies = await listCopies();
  for (const c of copies) c.isDefault = c.id === id;
  await writeAll(copies);
}

/** 删除副本：不允许删除最后一份；删除的是默认副本时自动把最旧的一份提升为默认 */
export async function deleteCopy(id: string): Promise<boolean> {
  const copies = await listCopies();
  if (copies.length <= 1) return false;
  const rest = copies.filter((c) => c.id !== id);
  if (rest.length === 0) return false;
  if (!rest.some((c) => c.isDefault)) rest[0]!.isDefault = true;
  await writeAll(rest);
  return true;
}

/** 副本内全部“可填键→值”（内置 entries + 自定义 custom，自定义键为 custom:name） */
export function valueMapOf(copy: ProfileCopy): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of copy.entries) m.set(e.fieldKey, e.value);
  for (const c of copy.custom ?? []) m.set(customKeyOfName(c.name), c.value);
  return m;
}

export function hasCopyField(copy: ProfileCopy, key: string): boolean {
  return valueMapOf(copy).has(key);
}

export function getCopyValue(copy: ProfileCopy, key: string): string | undefined {
  return valueMapOf(copy).get(key);
}

/** 页面识别出的 key 里、当前副本没有的（需要提示补充） */
export function missingKeys(copy: ProfileCopy, recognizedKeys: string[]): string[] {
  const have = valueMapOf(copy);
  return recognizedKeys.filter((k) => !have.has(k));
}

/** 副本里有、但页面本轮识别没有出现的（不填，仅提示） */
export function surplusKeys(copy: ProfileCopy, recognizedKeys: string[]): string[] {
  const all = [
    ...copy.entries.map((e) => e.fieldKey),
    ...(copy.custom ?? []).map((c) => customKeyOfName(c.name)),
  ];
  return all.filter((k) => !recognizedKeys.includes(k));
}

/** 新增或覆盖副本中的一条内置档案（同 key 覆盖，影响仅限该副本） */
export async function upsertEntry(
  copyId: string,
  fieldKey: FieldKey,
  value: string,
  source: ProfileEntry['source'] = 'user',
): Promise<ProfileCopy | undefined> {
  const copies = await listCopies();
  const c = copies.find((x) => x.id === copyId);
  if (!c) return undefined;
  const idx = c.entries.findIndex((e) => e.fieldKey === fieldKey);
  if (value.trim() === '') {
    if (idx >= 0) c.entries.splice(idx, 1); // 空值 = 删除该条
  } else if (idx >= 0) {
    c.entries[idx] = { fieldKey, value, updatedAt: Date.now(), source };
  } else {
    c.entries.push({ fieldKey, value, updatedAt: Date.now(), source });
  }
  c.updatedAt = Date.now();
  await writeAll(copies);
  return c;
}

export async function removeEntry(copyId: string, fieldKey: FieldKey): Promise<void> {
  const copies = await listCopies();
  const c = copies.find((x) => x.id === copyId);
  if (!c) return;
  c.entries = c.entries.filter((e) => e.fieldKey !== fieldKey);
  c.updatedAt = Date.now();
  await writeAll(copies);
}

/** 整份替换某副本的条目（options 编辑器"保存"用；自动去重同名 key） */
export async function replaceEntries(copyId: string, entries: ProfileEntry[]): Promise<void> {
  const copies = await listCopies();
  const c = copies.find((x) => x.id === copyId);
  if (!c) return;
  const map = new Map<FieldKey, ProfileEntry>();
  for (const e of entries) map.set(e.fieldKey, e);
  c.entries = [...map.values()].map((e) => ({ ...e, updatedAt: Date.now() }));
  c.updatedAt = Date.now();
  await writeAll(copies);
}

/** 整份替换某副本的结构化经历块（简历导入时使用） */
export async function replaceBlocks(
  copyId: string,
  blocks: ProfileCopy['blocks'],
): Promise<void> {
  const copies = await listCopies();
  const c = copies.find((x) => x.id === copyId);
  if (!c) return;
  const now = Date.now();
  c.blocks = blocks.map((b) => ({ ...b, updatedAt: now }));
  c.updatedAt = now;
  await writeAll(copies);
}

// ---------- 自定义字段 ----------

export async function upsertCustom(
  copyId: string,
  name: string,
  value: string,
): Promise<ProfileCopy | undefined> {
  const copies = await listCopies();
  const c = copies.find((x) => x.id === copyId);
  if (!c) return undefined;
  const trimmedName = name.trim();
  if (!trimmedName) return c;
  const custom = Array.isArray(c.custom) ? c.custom : [];
  const idx = custom.findIndex((x) => x.name === trimmedName);
  if (value.trim() === '') {
    if (idx >= 0) custom.splice(idx, 1);
  } else if (idx >= 0) {
    custom[idx] = { name: trimmedName, value, updatedAt: Date.now() };
  } else {
    custom.push({ name: trimmedName, value, updatedAt: Date.now() });
  }
  c.custom = custom;
  c.updatedAt = Date.now();
  await writeAll(copies);
  return c;
}

/** 整份替换某副本的自定义字段（options 编辑器“保存”用） */
export async function replaceCustom(
  copyId: string,
  values: CustomFieldValue[],
): Promise<void> {
  const copies = await listCopies();
  const c = copies.find((x) => x.id === copyId);
  if (!c) return;
  const seen = new Map<string, CustomFieldValue>();
  for (const v of values) {
    if (!v.name.trim() || !v.value.trim()) continue;
    seen.set(v.name.trim(), { ...v, name: v.name.trim() });
  }
  const now = Date.now();
  c.custom = [...seen.values()].map((v) => ({ ...v, updatedAt: now }));
  c.updatedAt = now;
  await writeAll(copies);
}
