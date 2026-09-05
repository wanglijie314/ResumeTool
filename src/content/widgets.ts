/**
 * 自定义控件（widget）填写驱动器：readonly 的"下拉/日期"型控件不能直接写值，
 * 必须模拟真人交互：点开 → 在弹出层里点选项 / 翻日历选日期。
 * 全部为启发式，任何一步失败都安全返回（绝不硬写只读框）。
 */
import type { WidgetHint } from '../shared/types';
import { bestMatchIndex } from '../shared/textMatch';

export interface WidgetOutcome {
  filled: boolean;
  notice?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

const POPUP_SELECTOR = [
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[class*="dropdown"]',
  '[class*="picker"]',
  '[class*="select-menu"]',
  '[class*="select-options"]',
  '[class*="option-list"]',
  '[class*="calendar"]',
  '[class*="date-panel"]',
  '[class*="datepicker"]',
  '[class*="layer"]',
  '[class*="panel"]',
].join(',');

function dist(a: DOMRect, b: DOMRect): number {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

function looksLikeChoice(root: Element): boolean {
  const els = root.querySelectorAll('[role="option"], li, [class*="option"], [class*="item"]');
  let n = 0;
  for (const e of els) {
    if (!isVisible(e)) continue;
    const t = (e.textContent ?? '').trim();
    if (t && t.length < 60 && e.getAttribute('aria-disabled') !== 'true') n++;
  }
  return n >= 1;
}

function looksLikeDate(root: Element): boolean {
  return (
    root.querySelectorAll('td, table, [role="gridcell"], [class*="day"]').length > 0 ||
    !!root.querySelector('[class*="header"]')
  );
}

/** 在输入框附近找"本次点击后出现的"目标弹出层 */
function findWidgetRoot(input: HTMLElement, kind: WidgetHint): HTMLElement | null {
  const rect = input.getBoundingClientRect();
  const hosts = Array.from(document.querySelectorAll<HTMLElement>(POPUP_SELECTOR));
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const h of hosts) {
    if (!isVisible(h)) continue;
    if (h === input || h.contains(input) || input.contains(h)) continue;
    const hr = h.getBoundingClientRect();
    if (hr.width < 20 || hr.height < 20) continue;
    const d = dist(rect, hr);
    if (d > 900) continue;
    const ok = kind === 'date' ? looksLikeDate(h) : looksLikeChoice(h);
    if (ok && d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  return best;
}

function openControl(input: HTMLElement): void {
  input.focus();
  input.click();
  try {
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  } catch {
    /* ignore */
  }
}

function pressEscape(): void {
  const target = document.activeElement as HTMLElement | null;
  if (!target) return;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
}

/** 模拟“hover 后点选”：部分日期/下拉组件需 mouseover/mousedown/mouseup 才触发选择 */
function simulatePick(el: HTMLElement): void {
  const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mouseenter', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  } catch {
    /* ignore */
  }
}

// ---------- 下拉选项 ----------

export async function fillChoice(input: HTMLElement, value: string): Promise<WidgetOutcome> {
  try {
    const v = value.trim();
    openControl(input);
    await sleep(300);
    const root = findWidgetRoot(input, 'choice');
    if (!root) return { filled: false, notice: '未找到下拉弹出层' };
    const items = Array.from(
      root.querySelectorAll('[role="option"], li, [class*="option"], [class*="item"]'),
    ).filter((e): e is HTMLElement => {
      if (!(e instanceof HTMLElement) || !isVisible(e)) return false;
      if (e.getAttribute('aria-disabled') === 'true') return false;
      const cls = (e.className && typeof e.className === 'string' ? e.className : '').toLowerCase();
      if (/(disabled|forbidden)/.test(cls)) return false;
      return (e.textContent ?? '').trim().length > 0 && (e.textContent ?? '').trim().length < 60;
    });
    const textOf = (e: HTMLElement): string => (e.textContent ?? '').trim();
    const exact =
      items.find((e) => textOf(e) === v) ??
      items.find((e) => e.getAttribute('data-value') === v);
    // 找不到完全相同时，选“最接近的选项”（如 本科 → 本科学历/本科(全日制)）
    let target: HTMLElement | undefined = exact;
    if (!target) {
      const idx = bestMatchIndex(items.map((e) => ({ text: textOf(e) })), v);
      if (idx !== null) target = items[idx];
    }
    if (!target) {
      pressEscape();
      return { filled: false, notice: `弹出层没有与“${v.slice(0, 20)}”相近的选项` };
    }
    simulatePick(target);
    await sleep(200);
    pressEscape();
    return { filled: true };
  } catch (e) {
    return { filled: false, notice: `下拉交互异常：${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------- 日期选择 ----------

interface Ym {
  y: number;
  m: number;
}

/** 支持 2024-09、2024年09月、2024-09-15 等；缺日默认 1 号 */
export function parseDateValue(v: string): { y: number; m: number; d: number } | null {
  const m = v.trim().match(/^(\d{4})\s*[-/年.]\s*(\d{1,2})\s*(?:[-/月.]\s*(\d{1,2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo, d: Number(m[3] ?? 1) };
}

function headerYm(root: Element): Ym | null {
  const els = root.querySelectorAll('div, span, button, [class*="header"] [class*="title"], [class*="header"]');
  for (const e of els) {
    if (e.children.length > 3) continue;
    const t = (e.textContent ?? '').replace(/\s+/g, '');
    const m = t.match(/(20\d{2})\s*[年.\-/]\s*(\d{1,2})\s*月?/);
    if (m && t.length <= 16) return { y: Number(m[1]), m: Number(m[2]) };
  }
  // 兜底：从格子 title 属性解析（title="2024-09-15"）
  for (const e of root.querySelectorAll('[title]')) {
    const t = e.getAttribute('title') ?? '';
    const m = t.match(/(20\d{2})[-/.](\d{1,2})[-/.]/);
    if (m) return { y: Number(m[1]), m: Number(m[2]) };
  }
  return null;
}

function navButton(root: Element, dir: -1 | 1): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll('button, [role="button"], [class*="nav"], [class*="header"] *')).filter(
    (e): e is HTMLElement => e instanceof HTMLElement && isVisible(e) && !e.hasAttribute('disabled') && (e.textContent ?? '').trim().length <= 4,
  );
  const look = dir === 1 ? /next|下月|next-month|›|>|»/i : /prev|上月|prev-month|‹|<|«/i;
  const clsLook = dir === 1 ? /next/i : /prev/i;
  return (
    buttons.find((b) => look.test(b.textContent ?? '') || clsLook.test(String(b.className))) ??
    buttons.find((b) => look.test(b.getAttribute('aria-label') ?? '')) ??
    null
  );
}

function clickDayCell(root: Element, target: { y: number; m: number; d: number }): boolean {
  const targetDate = `${target.y}-${String(target.m).padStart(2, '0')}-${String(target.d).padStart(2, '0')}`;
  const cells = Array.from(
    root.querySelectorAll('td, [role="gridcell"], [class*="day"], [class*="cell"]'),
  ).filter((e): e is HTMLElement => {
    if (!(e instanceof HTMLElement) || !isVisible(e)) return false;
    const cls = (e.className && typeof e.className === 'string' ? e.className : '').toLowerCase();
    if (/(other|prev-month|next-month|disabled|outside|placeholder)/.test(cls)) return false;
    const txt = (e.textContent ?? '').trim();
    // 日号格文本很短（1~2 位数字）；空文本的 td 也纳入（部分框架在格内渲染子元素）
    return txt === '' || txt.length <= 3;
  });
  // 1) 有完整日期元数据的
  const withMeta = cells.find((e) => {
    const meta = (e.getAttribute('title') ?? '') + ' ' + (e.getAttribute('aria-label') ?? '') + ' ' + (e.getAttribute('data-date') ?? '');
    return meta.includes(targetDate);
  });
  if (withMeta) {
    simulatePick(withMeta);
    return true;
  }
  // 2) 该月格子里文本等于日号的（导航已保证月份正确）
  const byText = cells.find((e) => (e.textContent ?? '').trim() === String(target.d));
  if (byText) {
    simulatePick(byText);
    return true;
  }
  return false;
}

function confirmIfNeeded(root: Element, input: HTMLElement): void {
  const current = (input as HTMLInputElement).value ?? '';
  const already = current && /20\d{2}/.test(current);
  if (already) return;
  const btns = Array.from(root.querySelectorAll('button')).filter((b) => isVisible(b));
  const ok = btns.find((b) => /^(确定|完成|确认|OK|好了|Done|Confirm)$/i.test((b.textContent ?? '').trim()));
  if (ok) ok.click();
}

export async function fillDate(input: HTMLElement, value: string): Promise<WidgetOutcome> {
  try {
    const target = parseDateValue(value);
    if (!target) {
      return { filled: false, notice: `无法解析日期“${value.slice(0, 20)}”（规范格式：2024.09 或 2024.09.15）` };
    }
    openControl(input);
    await sleep(350);
    const root = findWidgetRoot(input, 'date');
    if (!root) {
      // 兜底：控件其实可编辑时，按 xxxx.xx(.xx) 规范格式直接写入并触发事件
      if (input instanceof HTMLInputElement && !input.readOnly && !input.disabled) {
        const set = input as HTMLInputElement;
        const withDay = /(?:20\d{2})\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}/.test(value);
        const mm = String(target.m).padStart(2, '0');
        const dd = String(target.d).padStart(2, '0');
        const valStr = withDay ? `${target.y}.${mm}.${dd}` : `${target.y}.${mm}`;
        const proto = Object.getPrototypeOf(set) as { value?: unknown };
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(set, valStr);
        else set.value = valStr;
        set.dispatchEvent(new Event('input', { bubbles: true }));
        set.dispatchEvent(new Event('change', { bubbles: true }));
        set.blur();
        return (set.value ?? '').trim()
          ? { filled: true }
          : { filled: false, notice: '未找到日历弹出层，直接写入未生效' };
      }
      return { filled: false, notice: '未找到日历弹出层' };
    }

    // 翻月导航（最多 24 步防死循环）
    const want = { y: target.y, m: target.m };
    for (let i = 0; i < 24; i++) {
      const cur = headerYm(root);
      if (!cur) break;
      const delta = (want.y - cur.y) * 12 + (want.m - cur.m);
      if (delta === 0) break;
      const dir = delta > 0 ? 1 : -1;
      const btn = navButton(root, dir);
      if (!btn) break;
      btn.click();
      await sleep(150);
    }

    const clicked = clickDayCell(root, target);
    if (!clicked) {
      pressEscape();
      return { filled: false, notice: '日历里找不到该日期格子' };
    }
    await sleep(200);
    confirmIfNeeded(root, input);
    await sleep(120);
    pressEscape();
    return { filled: true };
  } catch (e) {
    return { filled: false, notice: `日期交互异常：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 总入口：按 widget 类型分派 */
export async function fillWidget(
  input: HTMLElement,
  value: string,
  widget: WidgetHint,
): Promise<WidgetOutcome> {
  return widget === 'date' ? fillDate(input, value) : fillChoice(input, value);
}
