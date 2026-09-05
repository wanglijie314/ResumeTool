/**
 * 从“候选文本”生成“新自定义字段名”建议。
 * 仅接受看起来像字段名的短文本：去掉引导词（请选择/请输入…）、必填标注、尾随冒号星号。
 * 返回 null 表示不提供建议（调用方应让用户手填，而不是把提示词当字段名）。
 */
export function suggestFieldName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .replace(/^(请选择|请填写|请输入|下拉选择|选择|填写)/, '')
    .replace(/[（(](必填|选填|必选项|选填项|可多选|选填项|请填写|例如[^（()）]*)[)）]/g, '')
    .replace(/[*:：…~]+$/g, '')
    .replace(/^(如|例|比如)[:：]?/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s.length > 24) return null;
  // 仍残留明显“提示词感”的拒绝给出建议
  if (/^(请输入|请选择|请填写|请输入您的)/.test(s)) return null;
  if (/^\d+$/.test(s)) return null;
  return s;
}
