/**
 * 填写执行器（按控件形态分策略）：
 *  - 纯文本 / 原生 select / 原生日期输入 / radio：直接写入（只填空、不覆盖、触发事件）；
 *  - 自定义控件 widget（只读下拉 / 日历选择器）：交给 widgets.ts 模拟真人点击选择。
 */
import { fillWidget } from './widgets';
import { bestMatchIndex } from '../shared/textMatch';
import type { ControlKind, WidgetHint } from '../shared/types';

export interface FillAttempt {
  filled: boolean;
  notice?: string;
}

function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const proto = Object.getPrototypeOf(el) as { value?: unknown };
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
}

function currentValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (el instanceof HTMLSelectElement) return el.value;
  return el.value ?? '';
}

/** 原生下拉：优先精确匹配，找不到时选“最接近的选项”（模糊最佳匹配） */
function selectOptionFor(select: HTMLSelectElement, value: string): HTMLOptionElement | null {
  const opts = Array.from(select.options);
  if (opts.length === 0) return null;
  const idx = bestMatchIndex(
    opts.map((o) => ({ text: o.textContent ?? o.value })),
    value,
  );
  return idx === null ? null : opts[idx] ?? null;
}

function radiosByName(name: string): HTMLInputElement[] {
  try {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${CSS.escape(name)}"]`,
      ),
    );
  } catch {
    return [];
  }
}

function fillTextLike(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): FillAttempt {
  if (el.readOnly || el.disabled) return { filled: false, notice: '只读/禁用' };
  if (currentValue(el).trim() !== '') return { filled: false, notice: '已有内容，不覆盖' };
  setNativeValue(el, value);
  return { filled: true };
}

function fillSelect(el: HTMLSelectElement, value: string): FillAttempt {
  if (el.disabled) return { filled: false, notice: '禁用' };
  if (currentValue(el).trim() !== '') return { filled: false, notice: '已有内容，不覆盖' };
  const opt = selectOptionFor(el, value);
  if (!opt) return { filled: false, notice: `下拉框无匹配选项“${value.slice(0, 20)}”` };
  setNativeValue(el, opt.value);
  return { filled: true };
}

function fillRadio(el: HTMLInputElement, value: string, name?: string): FillAttempt {
  if (el.disabled) return { filled: false, notice: '禁用' };
  const group = name ? radiosByName(name) : [el];
  const target = group.find((r) => {
    const labelText = (r.closest('label')?.textContent ?? '').trim();
    return labelText === value || r.value === value || labelText.includes(value.trim());
  });
  const checkedOne = group.find((r) => r.checked);
  if (checkedOne && (!target || checkedOne === target)) {
    return { filled: false, notice: '已有选择，不覆盖' };
  }
  if (!target) return { filled: false, notice: `无匹配选项“${value.slice(0, 20)}”` };
  if (!target.checked) target.click();
  return { filled: true };
}

export interface FillControlOptions {
  kind?: ControlKind;
  widget?: WidgetHint;
  radioName?: string;
}

/**
 * 尝试向一个控件填写 value。
 * 只读的自定义控件会进入模拟点击流程（可能耗时数百毫秒），因此为异步。
 */
export async function fillControl(
  el: HTMLElement,
  value: string,
  opts: FillControlOptions = {},
): Promise<FillAttempt> {
  if (!el.isConnected) return { filled: false, notice: '控件已不在页面' };
  const v = (value ?? '').trim();
  if (v === '') return { filled: false, notice: '值为空' };

  const kind = opts.kind;
  if (kind === 'widget' && opts.widget) {
    // 自定义下拉/日期 → 模拟真人点击
    if (!(el instanceof HTMLInputElement)) {
      return { filled: false, notice: '自定义控件不是输入框，暂不支持' };
    }
    const r = await fillWidget(el, v, opts.widget);
    return { filled: r.filled, notice: r.notice };
  }

  if (el.tagName === 'SELECT') return fillSelect(el as HTMLSelectElement, v);

  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    if (el.disabled) return { filled: false, notice: '禁用' };
    if (type === 'radio') return fillRadio(el, v, opts.radioName);
    if (type === 'checkbox') return { filled: false, notice: '复选框不自动操作' };
    if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return { filled: false, notice: `原生日期需要完整日期 YYYY-MM-DD（得到 ${v.slice(0, 20)}）` };
    }
    if (type === 'month' && !/^\d{4}-\d{2}$/.test(v)) {
      return { filled: false, notice: `月份输入需要 YYYY-MM（得到 ${v.slice(0, 20)}）` };
    }
    return fillTextLike(el, v);
  }

  if (el.tagName === 'TEXTAREA') return fillTextLike(el as HTMLTextAreaElement, v);

  return { filled: false, notice: '不支持的控件类型' };
}
