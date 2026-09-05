/** chrome.storage.local 的键与默认值（唯一事实来源） */
import type { LogSession, ProfileCopy, SiteIgnore, WordMapping } from './types';

export const STORAGE_KEYS = {
  settings: 'settings',
  learnedRules: 'learnedRules',
  siteIgnores: 'siteIgnores',
  profileCopies: 'profileCopies',
  logs: 'logSessions',
} as const;

export interface Settings {
  /** 自动扫描页面 */
  autoScan: boolean;
  /** 识别出表单控件后自动展开面板 */
  panelAutoShow: boolean;
  /** 高敏感字段（身份证等）填写前需确认 */
  sensitiveConfirm: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoScan: true,
  panelAutoShow: true,
  sensitiveConfirm: true,
};

export interface StorageShape {
  [STORAGE_KEYS.settings]: Settings;
  [STORAGE_KEYS.learnedRules]: WordMapping[];
  [STORAGE_KEYS.siteIgnores]: SiteIgnore[];
  [STORAGE_KEYS.profileCopies]: ProfileCopy[];
  [STORAGE_KEYS.logs]: LogSession[];
}

export const DEFAULT_STORAGE: StorageShape = {
  [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
  [STORAGE_KEYS.learnedRules]: [],
  [STORAGE_KEYS.siteIgnores]: [],
  [STORAGE_KEYS.profileCopies]: [],
  [STORAGE_KEYS.logs]: [],
};

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const raw = got[STORAGE_KEYS.settings];
  if (raw && typeof raw === 'object') {
    return { ...DEFAULT_SETTINGS, ...(raw as Settings) };
  }
  return { ...DEFAULT_SETTINGS };
}

/** 读取全局用户词表（教学 + 别名，共用一个表） */
export async function loadUserWords(): Promise<WordMapping[]> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.learnedRules);
  const raw = got[STORAGE_KEYS.learnedRules];
  return Array.isArray(raw) ? (raw as WordMapping[]) : [];
}
