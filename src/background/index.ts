/**
 * MV3 Service Worker（精简版）：
 *  - 安装/浏览器启动时写入默认存储、清理旧版遗留键；
 *  - 简单消息通道。工具栏点击后的"注入/扫描/填写"由 popup 直接驱动内容脚本。
 */
import { DEFAULT_STORAGE, STORAGE_KEYS, loadSettings } from '../shared/storage';

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
  sendResponse({ ok: false, error: 'unknown-message' });
  return false;
});

console.info('[简历一键填] service worker 已就绪');
