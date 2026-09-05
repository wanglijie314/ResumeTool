/**
 * M4：页面“经历多行组合”的探测与单行填充原语。
 * 探测基于真实 DOM：把“行内字段（有角色叫法）→ 同行祖先 → 成组（含区块标题/添加按钮）”聚簇；
 * 结果只描述结构，实际写值由调用方用 fillControl 按控件形态执行。
 */
import { kindOfHeading, rowRoleOfText, splitPeriod } from '../shared/rowRoles';
import type { RowRole } from '../shared/rowRoles';
import type { FieldKey } from '../shared/taxonomy';
import type { ClassifiedField, ExperienceBlock } from '../shared/types';

export interface RowCell {
  id: string;
  el: HTMLElement;
  role: RowRole;
  label: string;
  kind: string;
  widget?: 'date' | 'choice';
}

export interface RowGroup {
  kind: FieldKey | null;
  box: HTMLElement;
  addBtn: HTMLElement | null;
  rows: RowCell[][];
  /** 组内出现过的角色（供 UI 提示） */
  roles: RowRole[];
}

function isVisible(el: Element): boolean {
  try {
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    }
  } catch {
    /* ignore */
  }
  return !!el.getClientRects().length;
}

const ADD_TEXT = /^(添加|新增|增加|添加一行|新增一行|add)/i;

function findAddButton(root: Element): HTMLElement | null {
  for (const el of Array.from(root.querySelectorAll('button, a, [role="button"]'))) {
    if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
    if ((el instanceof HTMLButtonElement && el.disabled) || el.getAttribute('aria-disabled') === 'true') {
      continue;
    }
    const t = (el.textContent ?? '').trim();
    if (t && t.length <= 12 && ADD_TEXT.test(t)) return el;
  }
  return null;
}

function headingKind(box: Element): FieldKey | null {
  const els = Array.from(box.querySelectorAll('div,span,h1,h2,h3,h4,h5,h6,legend,p,label,em,b,strong'));
  for (const e of els) {
    if (!isVisible(e)) continue;
    if (e.querySelector('input, textarea, select')) continue;
    const t = (e.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 40) continue;
    const kind = kindOfHeading(t);
    if (kind) return kind;
  }
  return null;
}

/**
 * 探测页面经历行组合：
 * 1) 找所有“标签文本可归为行角色”的控件；
 * 2) 每个控件上溯到“只含自身所在行”的叶子行容器；
 * 3) 行容器再上溯聚成组（含 ≥2 行、或含“添加”按钮）；
 * 4) 从组里读区块标题归属 + 添加按钮句柄。
 */
export function detectRowGroups(
  fields: ClassifiedField[],
  elById: Map<string, HTMLElement>,
): RowGroup[] {
  const cells: { f: ClassifiedField; el: HTMLElement; role: RowRole }[] = [];
  for (const f of fields) {
    if (f.result.reasons.includes('#ignore#')) continue;
    const el = elById.get(f.candidate.id);
    if (!(el instanceof HTMLElement)) continue;
    const label = (f.candidate.labelText || f.candidate.placeholder || '').trim();
    const role = rowRoleOfText(label);
    if (!role || role === 'other') continue;
    cells.push({ f, el, role });
  }
  if (cells.length < 2) return [];

  const contains = (box: Element, cellEl: Element): boolean => box.contains(cellEl) || box === cellEl;
  const countIn = (box: Element): number => cells.filter((c) => contains(box, c.el)).length;

  // 叶子行：找“最低的、至少含 2 个角色格”的祖先作为一行
  const leafRowOf = (el: HTMLElement): HTMLElement => {
    let cur: HTMLElement | null = el;
    let guard = 0;
    while (cur && guard < 8) {
      guard++;
      if (countIn(cur) >= 2) return cur;
      const parent: HTMLElement | null = cur.parentElement;
      if (!parent || parent === document.body || parent.tagName === 'FORM') break;
      cur = parent;
    }
    return el;
  };

  const rowGroups = new Map<HTMLElement, HTMLElement[]>(); // leaf -> rows
  for (const c of cells) {
    const leaf = leafRowOf(c.el);
    const arr = rowGroups.get(leaf) ?? [];
    arr.push(c.el);
    rowGroups.set(leaf, arr);
  }
  // 行容器：拥有 ≥2 个角色格才算是“行模板行”
  const rowBoxes = [...rowGroups.keys()].filter((b) => rowGroups.get(b)!.length >= 2);
  if (rowBoxes.length === 0) return [];

  // 聚成组：以某一行开始向上找“含≥2行 或 含添加按钮”的容器
  const groups: RowGroup[] = [];
  const usedRows = new Set<HTMLElement>();
  for (const first of rowBoxes) {
    if (usedRows.has(first)) continue;
    let box: HTMLElement | null = first;
    let guard = 0;
    while (box && guard < 6) {
      guard++;
      const rowsInside = rowBoxes.filter((r) => box!.contains(r) || box === r);
      const hasAdd = !!findAddButton(box);
      const px: HTMLElement | null = box.parentElement;
      if (px && !(px === document.body || px.tagName === 'FORM') && rowsInside.length < 2 && !hasAdd) {
        box = px;
        continue;
      }
      break;
    }
    if (!box) continue;
    const rowsInside = rowBoxes.filter((r) => box!.contains(r) || box === r);
    if (rowsInside.length === 0) continue;
    const groupRows: RowCell[][] = [];
    for (const r of rowsInside) {
      if (usedRows.has(r)) continue;
      usedRows.add(r);
      const rowCells: RowCell[] = [];
      const seenRole = new Set<string>();
      for (const c of cells) {
        if (!(box!.contains(c.el) || box === c.el)) continue;
        if (!(r.contains(c.el) || r === c.el)) continue;
        if (seenRole.has(c.role)) continue; // 同角色取第一个
        seenRole.add(c.role);
        rowCells.push({
          id: c.f.candidate.id,
          el: c.el,
          role: c.role,
          label: c.f.candidate.labelText || c.f.candidate.placeholder || '',
          kind: c.f.candidate.kind,
          widget: c.f.candidate.widget,
        });
      }
      if (rowCells.length) groupRows.push(rowCells);
    }
    if (groupRows.length === 0) continue;
    const kind = headingKind(box);
    groups.push({
      kind,
      box,
      addBtn: findAddButton(box),
      rows: groupRows,
      roles: [...new Set(groupRows.flat().map((c) => c.role))],
    });
  }
  return groups;
}

/** 把一个 blocks 段展开为“行角色 → 值”（时间拆 start/end；各子字段直通） */
export function blockToRowValues(block: ExperienceBlock): Map<RowRole, string> {
  const out = new Map<RowRole, string>();
  const fieldOf = (role: string): string | undefined =>
    block.fields.find((f) => f.role === role)?.value;
  const period = fieldOf('period');
  if (period) {
    const sp = splitPeriod(period);
    if (sp.start) out.set('start', sp.start);
    if (sp.end) out.set('end', sp.end);
    out.set('period', period);
  }
  const mapping: { from: string; to: RowRole }[] = [
    { from: 'company', to: 'company' },
    { from: 'role', to: 'role' },
    { from: 'department', to: 'department' },
    { from: 'name', to: 'name' },
    { from: 'responsibility', to: 'responsibility' },
    { from: 'description', to: 'description' },
    { from: 'school', to: 'school' },
    { from: 'major', to: 'major' },
    { from: 'degree', to: 'degree' },
  ];
  for (const m of mapping) {
    const v = fieldOf(m.from);
    if (v) out.set(m.to, v);
  }
  return out;
}

export function rowGroupZh(kind: FieldKey): string {
  switch (kind) {
    case 'internship_experience':
      return '实习经历';
    case 'work_experience':
      return '工作经历';
    case 'project_experience':
      return '项目经历';
    case 'edu_experience':
      return '教育经历';
    case 'campus_experience':
      return '校园经历';
    case 'awards':
      return '获奖经历';
    default:
      return kind;
  }
}
