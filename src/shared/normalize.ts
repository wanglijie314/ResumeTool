/** 文本归一化：用于字段文本匹配（中文无空格分词，统一小写、去掉空白） */

export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\u00a0\u3000\u200b\ufeff]+/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[（(](?:必填|选填|必选项|选填项)[)）]/g, '')
    .replace(/[*:：]+$/g, '')
    .trim();
}

/** 截断为适合界面展示的文本 */
export function truncate(raw: string, max = 48): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
