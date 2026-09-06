/**
 * MV3 Service Worker：
 * - 安装/浏览器启动时写入默认存储、清理旧版遗留键；
 * - 简单消息通道；工具栏点击后的"注入/扫描/填写"由 popup 直接驱动内容脚本；
 * - AI 通道：AI_ANALYZE（页面字段匹配 skill）、AI_TEST（连接测试）。
 */
import { DEFAULT_STORAGE, STORAGE_KEYS, loadSettings } from '../shared/storage';
import { chatJson } from '../shared/aiProvider';
import { addAiSuggestions } from '../shared/aiSuggestions';
import { mappingKeyOf } from '../shared/learning';
import { listCopies } from '../shared/profile';
import { customKeyOfName } from '../shared/keys';
import { FIELD_DEFS } from '../shared/taxonomy';
import {
  buildPageMatchSystem,
  buildPageMatchUser,
  parsePageMatchJson,
} from '../skills/page-match';
import type { AiSuggestion } from '../shared/types';

/** M2 前的旧键（profileEntries 曾用），顺手清理 */
const LEGACY_KEYS = ['profileEntries'];

async function ensureDefaults(): Promise<void> {
  const got = await chrome.storage.local.get(null);
  const patch: Record<string, unknown> = {};
  for (const key of Object.values(STORAGE_KEYS)) {
    if (got[key] === undefined) {
      patch[key] = DEFAULT_STORAGE[key as keyof typeof DEFAULT_STORAGE];
    }
  }
  const removeKeys = LEGACY_KEYS.filter((k) => got[k] !== undefined);
  if (Object.keys(patch).length > 0) await chrome.storage.local.set(patch);
  if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
}

interface AiFieldIn {
  labelText?: string;
  placeholder?: string;
  name?: string;
  kind?: string;
  widget?: string;
}

async function aiPageMatch(fields: AiFieldIn[]): Promise<AiSuggestion[]> {
  const settings = await loadSettings();
  const copies = await listCopies();
  const customNames = [...new Set(copies.flatMap((c) => (c.custom ?? []).map((x) => x.name)))];
  const customKeys = customNames.map((n) => customKeyOfName(n));
  const allowed = new Set<string>([...FIELD_DEFS.map((d) => d.key), ...customKeys]);

  const list = fields.map((f, i) => ({
    index: i + 1,
    labelText: (f.labelText ?? '').trim(),
    placeholder: (f.placeholder ?? '').trim(),
    name: (f.name ?? '').trim(),
    kindText:
      f.widget === 'date' ? '日期选择器' : f.widget === 'choice' ? '下拉选择' : f.kind ?? '',
  }));

  const raw = await chatJson(settings, {
    system: buildPageMatchSystem(
      FIELD_DEFS.map((d) => ({ key: d.key, zh: d.zh })),
      customKeys,
    ),
    user: buildPageMatchUser(list),
  }, 30_000, '页面字段识别(page-match)');
  const parsed = parsePageMatchJson(raw, list.length, allowed);
  const suggestions = parsed
    .filter((r) => r.action !== 'skip')
    .map((r): Omit<AiSuggestion, 'id' | 'createdAt' | 'status'> => {
      const src = list[r.n - 1];
      const text = src?.labelText || src?.placeholder || src?.name || '';
      return {
        kind: 'page-field',
        labelKey: mappingKeyOf({ labelText: text }) || text,
        pageText: text,
        fieldKey: r.action === 'map' ? r.key ?? null : null,
        newFieldName: r.action === 'new' ? r.newFieldName : undefined,
        conf: r.conf,
      };
    });
  return suggestions.length ? await addAiSuggestions(suggestions) : [];
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaults();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureDefaults();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PING') {
    sendResponse({ ok: true, ts: Date.now() });
    return false;
  }
  if (msg?.type === 'GET_SETTINGS') {
    void loadSettings().then((s) => sendResponse({ ok: true, settings: s }));
    return true;
  }
  if (msg?.type === 'AI_ANALYZE') {
    const fields = Array.isArray(msg.fields) ? (msg.fields as AiFieldIn[]) : [];
    void (async () => {
      try {
        const suggestions = await aiPageMatch(fields);
        sendResponse({ ok: true, suggestions });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          code: e instanceof Error && 'code' in e ? (e as { code?: string }).code : undefined,
        });
      }
    })();
    return true;
  }
  if (msg?.type === 'AI_TEST') {
    void (async () => {
      try {
        const settings = await loadSettings();
        await chatJson(settings, {
          system: '你是连接测试助手。',
          user: '请只回复一个 JSON：{"ok": true}',
        }, 30_000, '连接测试(AI_TEST)');
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }
  sendResponse({ ok: false, error: 'unknown-message' });
  return false;
});

console.info('[简历一键填] service worker 已就绪');
