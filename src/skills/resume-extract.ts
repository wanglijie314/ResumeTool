/**
 * Skill：resume-extract —— 简历规则解析的 AI 兜底补全。
 * 规则解析（resumeParser）只认“标签:值”行，简历里大量“合并行/散行”会漏掉；
 * 本技能把「简历全文 + 规则已抽出的字段」一次性交给模型，补出遗漏或明显抽错的字段。
 *
 * 只输出能对应到内置标量字段的明确信息；结果一律是可编辑草稿，落副本前由用户决定。
 */
import { FIELD_DEFS, type FieldDef } from '../shared/taxonomy';

/** 简历里整段经历大类的键：AI 不应重建这些（由结构化区块负责） */
const COARSE_KEYS = new Set<string>([
  'edu_experience',
  'internship_experience',
  'work_experience',
  'project_experience',
  'campus_experience',
  'awards',
]);

/** AI 可补的内置标量字段（排除整段经历大类与照片） */
export const RESUME_SCALAR_FIELDS: readonly { key: string; zh: string; valueType: string }[] =
  FIELD_DEFS.filter((d) => !COARSE_KEYS.has(d.key) && d.valueType !== 'file').map(
    (d: FieldDef) => ({ key: d.key, zh: d.zh, valueType: d.valueType }),
  );

export const RESUME_SCALAR_KEYS: ReadonlySet<string> = new Set(
  RESUME_SCALAR_FIELDS.map((f) => f.key),
);

/** 发送给模型的简历正文上限（超长截断，避免请求过大） */
export const RESUME_TEXT_CAP = 20_000;
const VALUE_CAP_LONG = 2_000; // longtext 类（如自我评价）
const VALUE_CAP_SHORT = 200;

export interface ResumeParsedSummary {
  fieldKey: string;
  value: string;
}

export interface ResumeAiAddition {
  key: string;
  value: string;
  conf: number;
}

export interface ResumeAiDecision extends ResumeAiAddition {
  kind: 'added' | 'overridden';
}

export interface ResumeAddResult {
  decisions: ResumeAiDecision[];
  dropped: number;
}

export function buildResumeExtractSystem(
  fields: readonly { key: string; zh: string }[],
): string {
  const enumLines = fields.map((f) => `${f.key}=${f.zh}`).join('\n');
  return `你是一个简历信息补全助手。给定简历全文（来自 PDF/DOCX 抽取，格式可能错乱）和“规则已解析出的字段”，把规则解析遗漏或明显解析错误的信息补出来。

可用字段键（key=含义，只能从这些里选 key）：
${enumLines}

规则：
- 只补：规则没有抽到的、或明显抽错的内容（例如手机号拆错、漏掉独立成行的微信号）。
- 每条输出 {"key": ..., "value": ..., "conf": ...}。value 尽量照抄原文、去掉多余空白；不要改写、不要编造、不要脑补不存在的信息。
- 规则已解析出的字段会列给你；除非你能确定其值明显错误，否则不要再输出同一个 key。
- 属于经历/项目/自我评价的大段叙述不要整段塞进某个字段；只输出能对应单个字段的明确信息（如“党员”→ 政治面貌）。
- conf 填 0~1 的把握度，宁可少补不要乱补；拿不准就省略该条。
- 只输出 JSON 对象，不要任何解释文字：
{"results":[{"key":"wechat","value":"wxid_abc","conf":0.9}]}`;
}

export function buildResumeExtractUser(
  text: string,
  parsed: readonly ResumeParsedSummary[],
): string {
  const body =
    text.length > RESUME_TEXT_CAP
      ? `${text.slice(0, RESUME_TEXT_CAP)}\n…（原文过长已截断）`
      : text;
  const parsedLines =
    parsed.length > 0
      ? parsed
          .map((p) => `- ${p.fieldKey} = ${p.value.slice(0, 60)}`)
          .join('\n')
      : '（无）';
  return `简历全文：
------
${body}
------

规则已解析字段：
${parsedLines}

请输出补全结果 JSON（只含遗漏/明显错误的信息）。`;
}

function cleanValue(key: string, raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const def = FIELD_DEFS.find((d) => d.key === key);
  const cap = def?.valueType === 'longtext' ? VALUE_CAP_LONG : VALUE_CAP_SHORT;
  const oneLine = def?.valueType !== 'longtext';
  const v = oneLine ? s.replace(/\s+/g, ' ') : s.replace(/\n{3,}/g, '\n\n');
  return v.slice(0, cap);
}

/**
 * 严格校验模型输出：
 * - key 必须在允许列表（模型越权输出一律丢弃）；
 * - value 非空、按字段类型截断；
 * - 同一 key 只保留 conf 最高的一条。
 */
export function parseResumeExtractJson(
  raw: unknown,
  allowedKeys: ReadonlySet<string>,
): ResumeAiAddition[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as { results?: unknown }).results;
  if (!Array.isArray(arr)) return [];
  const out: ResumeAiAddition[] = [];
  const seen = new Map<string, number>();
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const row = it as Record<string, unknown>;
    const key = String(row.key ?? '').trim();
    if (!allowedKeys.has(key)) continue;
    const value = cleanValue(key, row.value);
    if (!value) continue;
    const conf = Math.min(1, Math.max(0, Number(row.conf) || 0.8));
    const prev = seen.get(key);
    if (prev !== undefined && out[prev]!.conf >= conf) continue;
    if (prev !== undefined) out.splice(prev, 1);
    seen.set(key, out.length);
    out.push({ key, value, conf });
  }
  return out;
}

/**
 * 把 AI 补全应用到「规则已解析条目」上，产出最终决策：
 * - 规则没有的键 → added（新增一行草稿）；
 * - 规则已有的键 → 仅 conf≥0.9 时 overridden（覆盖），否则丢弃（低档 AI 结果不覆盖确定解析）；
 * - 同一键的重复输出已在解析阶段取最高 conf。
 */
export function decideResumeAdditions(
  existing: readonly ResumeParsedSummary[],
  additions: readonly ResumeAiAddition[],
): ResumeAddResult {
  const existingKeys = new Set(existing.map((e) => e.fieldKey));
  const decisions: ResumeAiDecision[] = [];
  let dropped = 0;
  for (const a of additions) {
    if (existingKeys.has(a.key)) {
      if (a.conf >= 0.9) decisions.push({ ...a, kind: 'overridden' });
      else dropped++;
    } else {
      decisions.push({ ...a, kind: 'added' });
    }
  }
  return { decisions, dropped };
}
