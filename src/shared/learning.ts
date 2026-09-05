/**
 * M3 学习能力：全局用户词表 + 站点忽略 的读写。
 * 词表（WordMapping）全局生效：教学浮层自动写 source='taught'，
 * 别名管理手动写 source='alias'；分类器把词表放在最高优先级。
 */
import { normalizeText } from './normalize';
import { STORAGE_KEYS } from './storage';
import type { SiteIgnore, WordMapping } from './types';

export function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * 从控件的文本线索算出"词表匹配键"：
 * 优先页面标签，其次占位符，再退到 name 属性——教学时与识别时必须用同一套规则。
 */
export function mappingKeyOf(texts: {
  labelText?: string;
  placeholder?: string;
  name?: string;
}): string {
  const raw =
    (texts.labelText ?? '').trim() ||
    (texts.placeholder ?? '').trim() ||
    (texts.name ?? '').trim() ||
    '';
  return raw ? normalizeText(raw) : '';
}

// ---------- 全局用户词表 ----------

export async function listUserWords(): Promise<WordMapping[]> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.learnedRules);
  const raw = got[STORAGE_KEYS.learnedRules];
  return Array.isArray(raw) ? (raw as WordMapping[]) : [];
}

async function persist(words: WordMapping[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.learnedRules]: words });
}

/**
 * 新增/更新一个词条：同一文本存在时覆盖其字段归属（source 保留更"强"的 taught）。
 * 目标键既可是内置 taxonomy key，也可是自定义字段 key（custom:…）。
 * 文本会按 mappingKeyOf 归一化。
 */
export async function upsertWord(
  text: string,
  fieldKey: string,
  source: WordMapping['source'],
): Promise<WordMapping | undefined> {
  const key = mappingKeyOf({ labelText: text });
  if (!key) return undefined;
  const words = await listUserWords();
  const existing = words.find((w) => w.labelKey === key);
  const now = Date.now();
  let result: WordMapping;
  if (existing) {
    existing.fieldKey = fieldKey;
    existing.updatedAt = now;
    // 教学产生的归属比手动别名更“现场可信”，升级来源
    if (source === 'taught') existing.source = 'taught';
    result = existing;
  } else {
    result = {
      id: newId('word'),
      labelKey: key,
      fieldKey,
      source,
      createdAt: now,
      updatedAt: now,
      hits: 0,
    };
    words.push(result);
  }
  await persist(words);
  return result;
}

export async function removeWord(id: string): Promise<void> {
  const words = await listUserWords();
  await persist(words.filter((w) => w.id !== id));
}

export async function bumpWordHits(id: string): Promise<void> {
  const words = await listUserWords();
  const w = words.find((x) => x.id === id);
  if (!w) return;
  w.hits += 1;
  w.updatedAt = Date.now();
  await persist(words);
}

export async function removeWordsByField(fieldKey: string): Promise<void> {
  const words = await listUserWords();
  await persist(words.filter((w) => w.fieldKey !== fieldKey));
}

// ---------- 站点级忽略（某些站点的噪音控件，只在该站生效，不影响别站） ----------

export async function listIgnores(): Promise<SiteIgnore[]> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.siteIgnores);
  const raw = got[STORAGE_KEYS.siteIgnores];
  return Array.isArray(raw) ? (raw as SiteIgnore[]) : [];
}

async function persistIgnores(list: SiteIgnore[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.siteIgnores]: list });
}

export async function addIgnore(labelKey: string, domain: string): Promise<void> {
  if (!labelKey) return;
  const list = await listIgnores();
  if (list.some((i) => i.domain === domain && i.labelKey === labelKey)) return;
  list.push({ id: newId('ignore'), domain, labelKey, createdAt: Date.now() });
  await persistIgnores(list);
}

export async function removeIgnore(id: string): Promise<void> {
  const list = await listIgnores();
  await persistIgnores(list.filter((i) => i.id !== id));
}

export async function isIgnored(labelKey: string, domain: string): Promise<boolean> {
  const list = await listIgnores();
  return list.some((i) => i.domain === domain && i.labelKey === labelKey);
}
