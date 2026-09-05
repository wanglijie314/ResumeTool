/**
 * 字段键工具：区分“内置字段（taxonomy FieldKey）”与“用户自定义字段”。
 * 自定义字段采用 name 即身份：`custom:<encodeURIComponent(name)>`，
 * 跨副本/教学/词表都能以同一字符串键引用；展示时还原成名称。
 */
export const CUSTOM_PREFIX = 'custom:';

export function isCustomKey(key: string): boolean {
  return key.startsWith(CUSTOM_PREFIX);
}

export function customKeyOfName(name: string): string {
  return CUSTOM_PREFIX + encodeURIComponent(name.trim());
}

export function customNameOfKey(key: string): string {
  if (!key.startsWith(CUSTOM_PREFIX)) return key;
  const enc = key.slice(CUSTOM_PREFIX.length);
  try {
    return decodeURIComponent(enc);
  } catch {
    return enc;
  }
}
