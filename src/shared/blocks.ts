/**
 * 经历结构化块 ↔ 粗字段文本 的互转与编辑辅助（M4/M2 编辑器共用）。
 */
import type { FieldKey } from './taxonomy';
import type { ExperienceBlock, ProfileEntry } from './types';

/** 属于“结构化块”体系的经历大类 */
export const EXPERIENCE_BLOCK_KEYS: readonly FieldKey[] = [
  'edu_experience',
  'internship_experience',
  'work_experience',
  'project_experience',
  'campus_experience',
  'awards',
];

export function isExperienceBlockKey(key: string): boolean {
  return (EXPERIENCE_BLOCK_KEYS as readonly string[]).includes(key);
}

const zh: Record<string, string> = {
  edu_experience: '教育经历',
  internship_experience: '实习经历',
  work_experience: '工作经历',
  project_experience: '项目经历',
  campus_experience: '校园经历',
  awards: '获奖经历',
};

export function experienceKindZh(kind: FieldKey): string {
  return zh[kind] ?? kind;
}

const fieldOf = (b: ExperienceBlock, role: string): string | undefined =>
  b.fields.find((f) => f.role === role)?.value;

/** 把一段结构化经历还原成人类可读的整段文本（不带头部标题，值即正文） */
export function blockToText(b: ExperienceBlock): string {
  const name = fieldOf(b, 'name') || fieldOf(b, 'company') || fieldOf(b, 'school');
  const role = fieldOf(b, 'role') || fieldOf(b, 'major') || fieldOf(b, 'degree');
  const period = fieldOf(b, 'period');
  const responsibility = fieldOf(b, 'responsibility');
  const description = fieldOf(b, 'description');
  const lines: string[] = [];
  const head = [name, role, period].filter(Boolean).join(' ');
  if (head) lines.push(head);
  if (responsibility) lines.push(responsibility);
  if (description) lines.push(description);
  return lines.join('\n').trim();
}

/** 同大类的多段经历 → 整段文本（段与段之间空行分隔） */
export function composeCoarseForKind(kind: FieldKey, blocks: ExperienceBlock[]): string {
  const same = blocks.filter((b) => b.kind === kind);
  if (same.length === 0) return '';
  return same.map(blockToText).join('\n\n');
}

/** 用结构化块重算/替换 entries 里的“整段”粗条目（同名内置其它字段保留） */
export function replaceCoarseFromBlocks(
  entries: ProfileEntry[],
  blocks: ExperienceBlock[],
): ProfileEntry[] {
  const map = new Map<string, ProfileEntry>();
  for (const e of entries) map.set(e.fieldKey, e);
  const present = new Set(blocks.map((b) => b.kind));
  for (const kind of present) {
    const text = composeCoarseForKind(kind, blocks);
    if (text) {
      map.set(kind, { fieldKey: kind, value: text, updatedAt: Date.now(), source: 'user' });
    }
  }
  return [...map.values()];
}
