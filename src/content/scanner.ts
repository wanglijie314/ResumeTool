/**
 * 表单扫描器：收集页面里"可被填写/识别"的表单控件，产出 FieldCandidate 快照。
 * 真实 DOM 引用登记在 ElementRegistry 中，供面板高亮/后续填写定位。
 */
import { normalizeText } from '../shared/normalize';
import type { ControlKind, FieldCandidate, LabelSource, WidgetHint } from '../shared/types';

const SKIP_INPUT_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'file',
  'password',
  'range',
  'color',
]);

const NATIVE_DATE_TYPES = new Set([
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

export class ElementRegistry {
  private map = new Map<string, Element>();
  private seq = 0;

  register(el: Element): string {
    const id = `jl-el-${++this.seq}`;
    this.map.set(id, el);
    return id;
  }

  get(id: string): Element | undefined {
    return this.map.get(id);
  }

  clear(): void {
    this.map.clear();
  }
}

function textOf(node: Node | null | undefined): string {
  if (!node) return '';
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function isVisible(el: HTMLElement): boolean {
  try {
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    }
  } catch {
    /* ignore */
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** 相邻"小文本行"启发：向上找只包含当前控件、且文本较短的容器（典型：<span>姓名</span><input/>） */
function rowText(el: HTMLElement): string | null {
  let node: HTMLElement | null = el;
  for (let depth = 0; depth < 5; depth++) {
    if (!node) return null;
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) return null;
    if (parent === document.body || parent.tagName === 'FORM') break;
    const siblingsControls = parent.querySelectorAll('input, textarea, select, button');
    if (siblingsControls.length > 1) break; // 容器里有其它控件，不是"单行标签"
    const txt = textOf(parent);
    if (txt && txt.length <= 36 && !/^\d+$/.test(txt)) {
      return txt;
    }
    node = parent;
  }
  return null;
}

/** 收集一个控件的候选标签来源（按可信度顺序返回） */
function collectLabelSources(el: HTMLElement): LabelSource[] {
  const out: LabelSource[] = [];

  const alb = el.getAttribute('aria-labelledby');
  if (alb) {
    const parts = alb
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .map((n) => textOf(n))
      .filter(Boolean);
    if (parts.length) out.push({ text: parts.join(' '), how: 'aria-labelledby' });
  }

  const id = el.id;
  if (id) {
    try {
      const forLabel = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`);
      const t = textOf(forLabel);
      if (t) out.push({ text: t, how: 'label-for' });
    } catch {
      /* 非法选择器时跳过 */
    }
  }

  const wrapping = el.closest('label');
  const wt = textOf(wrapping);
  if (wt) out.push({ text: wt, how: 'wrapping-label' });

  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) out.push({ text: aria.trim(), how: 'aria-label' });

  const row = rowText(el);
  if (row) out.push({ text: row, how: 'preceding' });

  const ph = el.getAttribute('placeholder');
  if (ph && ph.trim()) out.push({ text: ph.trim(), how: 'placeholder' });

  return out;
}

function bestLabel(sources: LabelSource[]): string {
  const order: LabelSource['how'][] = [
    'aria-labelledby',
    'label-for',
    'wrapping-label',
    'aria-label',
    'preceding',
    'placeholder',
  ];
  for (const how of order) {
    const hit = sources.find((s) => s.how === how && s.text.trim());
    if (hit) return hit.text.slice(0, 80);
  }
  return '';
}

/**
 * 控件形态判定：
 *  - 原生 select / textarea / 各原生日期 type / radio / checkbox 直接按标签定；
 *  - 文本输入里"只读 + 触发结构"的视为自定义控件(widget)：收集
 *    祖先类名/aria/相邻按钮图标/占位符线索，猜 下拉(choice) 或 日期(date)。
 */
function analyzeKind(el: HTMLElement): { kind: ControlKind; widget?: WidgetHint } {
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return { kind: 'textarea' };
  if (tag === 'SELECT') return { kind: 'select' };
  const type = (el as HTMLInputElement).type || 'text';
  const t = type.toLowerCase();
  if (t === 'radio') return { kind: 'radio' };
  if (t === 'checkbox') return { kind: 'checkbox' };
  if (NATIVE_DATE_TYPES.has(t)) return { kind: 'native-date' };

  // 文本型：只读 + 有触发/图标结构 → 自定义控件
  const isReadOnly = el.hasAttribute('readonly') || el.getAttribute('aria-readonly') === 'true';
  if (!isReadOnly) return { kind: 'text' };

  const clues: string[] = [];
  const push = (s: string | null | undefined): void => {
    if (s && s.trim()) clues.push(s.toLowerCase());
  };
  push(el.getAttribute('aria-haspopup'));
  push(el.getAttribute('role'));
  push(el.getAttribute('placeholder'));
  push(el.className && typeof el.className === 'string' ? el.className : undefined);
  let node: HTMLElement | null = el;
  for (let d = 0; d < 3 && node; d++) {
    push(node.className && typeof node.className === 'string' ? node.className : undefined);
    node = node.parentElement;
  }
  const wrap = el.parentElement ?? el;
  for (const clickable of wrap.querySelectorAll('button, [role="button"], i, svg, span[class*="icon"]')) {
    push(clickable.className && typeof clickable.className === 'string' ? clickable.className : undefined);
    push(clickable.getAttribute('aria-label'));
    push(clickable.textContent);
    if (clickable.tagName === 'svg' || clickable.tagName === 'I') {
      push((clickable as HTMLElement).dataset?.icon ?? undefined);
    }
  }

  const joined = clues.join(' ');
  const dateScore =
    (joined.match(/date|calendar|picker|日期|日历|年月|time|时间/g) ?? []).length;
  const choiceScore =
    (joined.match(/select|dropdown|combo|chosen|choice|选项|选择器|menu|listbox/g) ?? []).length;
  if (choiceScore > dateScore) return { kind: 'widget', widget: 'choice' };
  if (dateScore > 0) return { kind: 'widget', widget: 'date' };

  const hp = el.getAttribute('aria-haspopup');
  if (hp) {
    const v = hp.toLowerCase();
    if (v === 'dialog' || v === 'grid') return { kind: 'widget', widget: 'date' };
    return { kind: 'widget', widget: 'choice' };
  }
  // 只读但没更多线索：按最常见情况当"下拉选择"尝试；失败会安全跳过并记录
  return { kind: 'widget', widget: 'choice' };
}

function describeControl(el: HTMLElement): Omit<FieldCandidate, 'id'> {
  const labelSources = collectLabelSources(el);
  const labelText = bestLabel(labelSources);
  const placeholder = el.getAttribute('placeholder') ?? '';
  const ariaLabel = el.getAttribute('aria-label') ?? '';
  const name = el.getAttribute('name') ?? '';
  const idAttr = el.id ?? '';

  let optionTexts: string[] = [];
  if (el.tagName === 'SELECT') {
    optionTexts = Array.from((el as HTMLSelectElement).options)
      .map((o) => (o.textContent ?? o.value).trim())
      .filter((o) => o && o.length < 30)
      .slice(0, 20);
  }

  const haystackParts = [labelText, placeholder, ariaLabel, name, idAttr];
  const haystack = normalizeText(haystackParts.join(' '));

  const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';

  const { kind, widget } = analyzeKind(el);

  return {
    tag: (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
      ? el.tagName.toLowerCase()
      : 'input') as FieldCandidate['tag'],
    inputType:
      el.tagName === 'INPUT' ? ((el as HTMLInputElement).type || 'text').toLowerCase() : '',
    kind,
    widget,
    labelText,
    labelSources: labelSources.slice(0, 4),
    placeholder,
    name,
    idAttr,
    ariaLabel,
    optionTexts,
    required,
    readonly: el.hasAttribute('readonly') || (el as HTMLInputElement).readOnly === true,
    disabled:
      el.hasAttribute('disabled') ||
      (el as HTMLInputElement).disabled === true ||
      el.getAttribute('aria-disabled') === 'true',
    haystack,
  };
}

/** 单选控件的"自身选项标签"（男/女…） */
function radioOptionLabel(el: HTMLElement): string {
  const wrap = el.closest('label');
  const t = textOf(wrap);
  if (t) return t.slice(0, 20);
  return textOf(el.parentElement).slice(0, 20);
}

function groupLabel(container: HTMLElement, optionTexts: string[]): string {
  const legend = container.querySelector('legend');
  const lt = textOf(legend);
  if (lt && lt.length <= 24) return lt;
  let t = textOf(container);
  for (const o of optionTexts) t = t.replace(o, '');
  t = t.replace(/\s+/g, '').trim();
  if (t && t.length <= 24) return t;
  return '';
}

export interface CollectResult {
  candidates: FieldCandidate[];
}

export function collectCandidates(root: Document | HTMLElement, reg: ElementRegistry): CollectResult {
  reg.clear();
  const controls = Array.from(
    root.querySelectorAll<HTMLElement>('input, textarea, select'),
  );

  interface RadioGroup {
    name: string;
    els: HTMLElement[];
    firstIdx: number;
  }
  const radioGroups = new Map<string, RadioGroup>();
  const plain: { candidate: FieldCandidate; idx: number }[] = [];

  controls.forEach((el, idx) => {
    if (!isVisible(el)) return;
    const type = el.tagName === 'INPUT' ? ((el as HTMLInputElement).type || 'text').toLowerCase() : '';
    if (el.tagName === 'INPUT' && SKIP_INPUT_TYPES.has(type)) return;

    if (el.tagName === 'INPUT' && type === 'radio') {
      const key = el.getAttribute('name') ?? `__noradio_${idx}`;
      const g = radioGroups.get(key);
      if (g) {
        g.els.push(el);
      } else {
        radioGroups.set(key, { name: key, els: [el], firstIdx: idx });
      }
      return;
    }

    plain.push({ candidate: buildCandidate(el, reg), idx });
  });

  for (const g of radioGroups.values()) {
    const first = g.els[0]!;
    const optionTexts = g.els.map(radioOptionLabel).filter(Boolean).slice(0, 8);
    const container = commonAncestor(g.els);
    const groupLabelText = container ? groupLabel(container, optionTexts) : '';
    const base = describeControl(first);
    base.optionTexts = optionTexts;
    if (groupLabelText) {
      base.labelText = groupLabelText.slice(0, 80);
      base.labelSources = [
        { text: groupLabelText.slice(0, 80), how: 'radio-group' },
        ...base.labelSources.filter((s) => s.how !== 'preceding'),
      ];
      base.haystack = normalizeText([groupLabelText, base.name, base.idAttr].join(' '));
    }
    const cand: FieldCandidate = { ...base, id: reg.register(first) };
    plain.push({ candidate: cand, idx: g.firstIdx });
  }

  plain.sort((a, b) => a.idx - b.idx);
  return { candidates: plain.map((p) => p.candidate) };
}

function buildCandidate(el: HTMLElement, reg: ElementRegistry): FieldCandidate {
  return { ...describeControl(el), id: reg.register(el) };
}

function commonAncestor(els: HTMLElement[]): HTMLElement | null {
  let node: HTMLElement | null = els[0] ?? null;
  if (!node) return null;
  for (let depth = 0; depth < 6 && node; depth++) {
    if (els.every((e) => node!.contains(e))) return node;
    node = node.parentElement;
  }
  return node;
}
