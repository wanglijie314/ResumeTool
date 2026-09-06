/**
 * Skill：page-match —— 把“页面控件清单”一次性映射到字段键（内置/自定义/新增）。
 * 这是“AI 要干什么”的任务说明资产；执行层（aiProvider）只负责把它与现场数据发给模型。
 */

export interface PageFieldInput {
  /** 从 1 开始，与回传 JSON 的 n 对齐 */
  index: number;
  labelText: string;
  placeholder: string;
  kindText: string;
  /** 原生选项文本（下拉/单选可选） */
  optionSample?: string[];
}

export interface PageMatchOutput {
  /** 输入序号 */
  n: number;
  /** map：映射到现有字段键；new：建议新增自定义字段；skip：跳过/说不准 */
  action: 'map' | 'new' | 'skip';
  /** action=map 时的字段键（只允许给定的枚举值） */
  key?: string;
  /** action=new 时的建议字段名 */
  newFieldName?: string;
  /** 给用户看的字段中文名（map 时可不填，会回填） */
  display?: string;
  conf: number;
  reason?: string;
}

/** 可允许键列表（内置字段 + 用户自定义键） */
export function buildPageMatchSystem(
  allowedFields: { key: string; zh: string }[],
  customKeys: string[],
): string {
  const enumLines = allowedFields
    .map((f) => `${f.key}=${f.zh}`)
    .join('\n');
  const customPart =
    customKeys.length > 0
      ? `\n我的自定义字段键（这些也可以作为 key）：\n${customKeys.join('、')}`
      : '\n（当前没有自定义字段，如需新增请用 action=new）';
  return `你是一个招聘简历表单字段识别助手。页面字段的叫法五花八门，你需要把每个“页面字段”判断成我们系统里的一个字段键。

可用的内置字段键（key=含义，只能从这些里选 key）：
${enumLines}
${customPart}

规则：
- 优先 map 到最贴切的内置/自定义键；
- 内置或自定义键都不贴切时，action 用 new 并给出建议字段名（newFieldName），不要强行 map；
- 明确无关或不确定时 action 用 skip；
- conf 填 0~1 的把握度，宁可保守不要虚高。

只输出一个 JSON 对象，不要任何解释文字：
{
  "results": [
    { "n": 1, "action": "map", "key": "mobile", "conf": 0.98 },
    { "n": 2, "action": "new", "newFieldName": "居住城市", "conf": 0.9 }
  ]
}`;
}

export function buildPageMatchUser(fields: PageFieldInput[]): string {
  const lines = fields.map((f) => {
    const sample = f.optionSample?.length ? ` | 选项示例: ${f.optionSample.slice(0, 8).join('/')}` : '';
    return `${f.index}. 标签：${f.labelText || '(无)'} | 提示词：${f.placeholder || '(无)'} | 形态：${f.kindText}${sample}`;
  });
  return `请分析下面这些页面字段分别对应哪个字段键：\n${lines.join('\n')}`;
}

/** 解析模型输出并做严格校验（键必须在允许列表、n 必须在范围内），返回干净结果 */
export function parsePageMatchJson(
  raw: unknown,
  fieldCount: number,
  allowedKeys: ReadonlySet<string>,
): PageMatchOutput[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as { results?: unknown }).results;
  if (!Array.isArray(arr)) return [];
  const out: PageMatchOutput[] = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const row = it as Record<string, unknown>;
    const n = Number(row.n);
    if (!Number.isInteger(n) || n < 1 || n > fieldCount) continue;
    const action = row.action === 'map' || row.action === 'new' ? row.action : 'skip';
    const conf = Math.min(1, Math.max(0, Number(row.conf) || 0.8));
    if (action === 'skip') {
      out.push({ n, action, conf });
      continue;
    }
    if (action === 'new') {
      const name = String(row.newFieldName ?? '').trim().slice(0, 24);
      if (!name) continue;
      out.push({ n, action: 'new', newFieldName: name, conf });
      continue;
    }
    // map
    const key = String(row.key ?? '').trim();
    if (!allowedKeys.has(key)) continue;
    out.push({ n, action: 'map', key, display: String(row.display ?? '').slice(0, 40) || undefined, conf });
  }
  return out;
}
