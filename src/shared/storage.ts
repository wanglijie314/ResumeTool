/** chrome.storage.local 的键与默认值（唯一事实来源） */
import type { AiSuggestion, LogSession, ProfileCopy, SiteIgnore, WordMapping } from './types';

export const STORAGE_KEYS = {
  settings: 'settings',
  learnedRules: 'learnedRules',
  siteIgnores: 'siteIgnores',
  profileCopies: 'profileCopies',
  logs: 'logSessions',
  aiSuggestions: 'aiSuggestions',
} as const;

export interface Settings {
  /** 自动扫描页面 */
  autoScan: boolean;
  /** 识别出表单控件后自动展开面板 */
  panelAutoShow: boolean;
  /** 高敏感字段（身份证等）填写前需确认 */
  sensitiveConfirm: boolean;
  /** AI 模型通道（智谱等兼容端点，请求 /chat/completions） */
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
}

export const DEFAULT_SETTINGS: Settings = {
  autoScan: true,
  panelAutoShow: true,
  sensitiveConfirm: true,
  aiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  aiModel: '',
  aiApiKey: '',
};

export interface StorageShape {
  [STORAGE_KEYS.settings]: Settings;
  [STORAGE_KEYS.learnedRules]: WordMapping[];
  [STORAGE_KEYS.siteIgnores]: SiteIgnore[];
  [STORAGE_KEYS.profileCopies]: ProfileCopy[];
  [STORAGE_KEYS.logs]: LogSession[];
  [STORAGE_KEYS.aiSuggestions]: AiSuggestion[];
}

export const DEFAULT_STORAGE: StorageShape = {
  [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
  [STORAGE_KEYS.learnedRules]: [],
  [STORAGE_KEYS.siteIgnores]: [],
  [STORAGE_KEYS.profileCopies]: [],
  [STORAGE_KEYS.logs]: [],
  [STORAGE_KEYS.aiSuggestions]: [],
};

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const raw = got[STORAGE_KEYS.settings];
  if (raw && typeof raw === 'object') {
    return { ...DEFAULT_SETTINGS, ...(raw as Settings) };
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await loadSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

/** 读取全局用户词表（教学 + 别名，共用一个表） */
export async function loadUserWords(): Promise<WordMapping[]> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.learnedRules);
  const raw = got[STORAGE_KEYS.learnedRules];
  return Array.isArray(raw) ? (raw as WordMapping[]) : [];
}
