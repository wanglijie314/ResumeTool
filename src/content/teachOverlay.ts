/**
 * 页面内教学浮层（M3+）：处理"未识别字段"。
 * 主流程 = 新增自定义字段：未识别即说明现有字段集没有它，默认按"新增字段"处理，
 * 字段名默认取页面文案（可改），可顺带补充值（写入默认副本），并全局记住该文案 → 新字段。
 * 次级操作：归类到已有字段 / 本站忽略 / 跳过。
 */
import { FIELD_DEFS, FIELD_GROUPS, fieldZh } from '../shared/taxonomy';
import { customKeyOfName } from '../shared/keys';
import { attachDrag } from './drag';

export interface TeachItem {
  labelKey: string;
  display: string;
  kindText: string;
  /** 是否只有输入提示词、没有真实字段标签 */
  placeholderOnly?: boolean;
  /** 新字段名建议（仅当来自真实标签时给出；否则空，让用户手填） */
  suggest?: string | null;
}

export interface TeachHandlers {
  /** 主流程：新增自定义字段。name/value 已由用户填好（value 可空） */
  onAddCustom: (item: TeachItem, name: string, value: string) => Promise<void>;
  /** 次级：归到某个已有（或已有的自定义）字段 */
  onTeach: (item: TeachItem, fieldKey: string) => Promise<void>;
  onIgnore: (item: TeachItem) => Promise<void>;
  onClose: () => void;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.jl-t-wrap {
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483002;
  width: 400px; max-width: calc(100vw - 36px);
  font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #1f2937;
  background: #fff; border: 1px solid #dbeafe; border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.22);
}
.jl-t-head {
  display: flex; align-items: center; gap: 8px;
  background: linear-gradient(135deg, #1d4ed8, #2563eb); color: #fff;
  padding: 8px 12px; border-radius: 12px 12px 0 0; cursor: move;
  user-select: none;
}
.jl-t-head b { font-size: 13px; }
.jl-t-head .sub { font-size: 11px; opacity: 0.85; }
.jl-t-head .sp { flex: 1; }
.jl-t-close {
  border: none; background: rgba(255,255,255,.18); color: #fff;
  border-radius: 6px; padding: 2px 9px; cursor: pointer; font-size: 12px;
}
.jl-t-body { max-height: 55vh; overflow-y: auto; padding: 8px 10px; }
.jl-t-item { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px; margin-bottom: 8px; background: #f8fafc; }
.jl-t-txt { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.jl-t-note { font-size: 11.5px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 4px 8px; margin-bottom: 6px; word-break: break-all; }
.jl-t-display { font-weight: 600; color: #0f172a; word-break: break-all; }
.jl-t-kind { font-size: 11px; background: #eef2ff; color: #3730a3; border-radius: 6px; padding: 0 6px; }
.jl-t-fields { display: flex; flex-direction: column; gap: 5px; }
.jl-t-fields input {
  border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 8px;
  font-size: 12.5px; font-family: inherit; width: 100%;
}
.jl-t-fields .name-row { display: flex; align-items: center; gap: 6px; }
.jl-t-fields .name-row span { color: #64748b; font-size: 11.5px; white-space: nowrap; }
.jl-t-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.jl-t-btn { border: none; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.jl-t-btn.primary { background: #1d4ed8; color: #fff; }
.jl-t-btn.primary:hover { background: #1e40af; }
.jl-t-btn.ghost { background: #fff; color: #475569; border: 1px solid #cbd5e1; }
.jl-t-btn.danger { background: #fff; color: #b91c1c; border: 1px solid #fecaca; }
.jl-t-btn:disabled { opacity: .55; cursor: not-allowed; }
.jl-t-selrow { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.jl-t-selrow select {
  flex: 1; min-width: 0; border: 1px solid #cbd5e1; border-radius: 6px;
  padding: 4px 6px; font-size: 12.5px; font-family: inherit;
}
.jl-t-empty { color: #94a3b8; text-align: center; padding: 14px 0; font-size: 12px; }
.jl-t-foot { border-top: 1px solid #eef2f7; padding: 6px 12px; display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #64748b; }
.jl-t-foot .sp { flex: 1; }
.jl-t-fini {
  background: #eff6ff; color: #1e40af; padding: 8px 12px; font-size: 12.5px;
  border-top: 1px solid #dbeafe;
}
`;

function existingSelect(customNames: string[]): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.innerHTML = '<option value="">请选择该字段的含义…</option>';
  for (const g of FIELD_GROUPS) {
    const og = document.createElement('optgroup');
    og.label = g.zh;
    for (const d of FIELD_DEFS.filter((x) => x.group === g.key)) {
      const o = document.createElement('option');
      o.value = d.key;
      o.textContent = `${d.zh}${d.sensitive ? ' 🔒' : ''}`;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  if (customNames.length) {
    const og = document.createElement('optgroup');
    og.label = '我的自定义字段';
    for (const name of customNames) {
      const o = document.createElement('option');
      o.value = customKeyOfName(name);
      o.textContent = `${name}（自定义）`;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  return sel;
}

export function openTeachOverlay(
  items: TeachItem[],
  handlers: TeachHandlers,
  customNames: string[] = [],
): { close: () => void } {
  const host = document.createElement('div');
  host.id = '__jianli_teach_host__';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'jl-t-wrap';
  shadow.appendChild(wrap);

  const head = document.createElement('div');
  head.className = 'jl-t-head';
  const title = document.createElement('b');
  title.textContent = '未识别字段 → 新增或归类';
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = '先“新增字段”，教一次全局记住';
  const spacer = document.createElement('span');
  spacer.className = 'sp';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'jl-t-close';
  closeBtn.textContent = '完成 ✕';
  head.append(title, sub, spacer, closeBtn);
  attachDrag(head, wrap);
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'jl-t-body';
  wrap.appendChild(body);

  const fini = document.createElement('div');
  fini.className = 'jl-t-fini';
  fini.style.display = 'none';
  wrap.appendChild(fini);

  const foot = document.createElement('div');
  foot.className = 'jl-t-foot';
  const state = document.createElement('span');
  foot.appendChild(state);
  const sp2 = document.createElement('span');
  sp2.className = 'sp';
  foot.appendChild(sp2);
  wrap.appendChild(foot);

  let remaining = items.length;
  const processed = new Set<string>();

  function renderState(): void {
    state.textContent = `待处理 ${remaining} 项`;
    if (remaining === 0) {
      fini.style.display = '';
      fini.textContent = '全部处理完毕 ✅ 新增/归类结果已全局记住：下次自动识别。可关闭后重开弹窗查看。';
    }
  }

  function done(row: HTMLElement, label: string): void {
    row.remove();
    remaining--;
    renderState();
    void label;
  }

  function rowFor(item: TeachItem): void {
    if (processed.has(item.labelKey)) return;
    const row = document.createElement('div');
    row.className = 'jl-t-item';

    const txt = document.createElement('div');
    txt.className = 'jl-t-txt';
    const disp = document.createElement('span');
    disp.className = 'jl-t-display';
    disp.textContent = `“${item.display}”`;
    const kind = document.createElement('span');
    kind.className = 'jl-t-kind';
    kind.textContent = item.kindText;
    txt.append(disp, kind);

    // —— 默认：新增自定义字段 ——
    const fields = document.createElement('div');
    fields.className = 'jl-t-fields';
    const nameRow = document.createElement('div');
    nameRow.className = 'name-row';
    const nameHint = document.createElement('span');
    nameHint.textContent = '新字段名';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = item.suggest ?? '';
    nameInput.placeholder = item.placeholderOnly
      ? '该控件只有提示词没有标签，请手动输入字段名'
      : '建议沿用页面叫法，可修改';
    nameRow.append(nameHint, nameInput);
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.placeholder = '顺手补充该字段的值（可留空，之后在弹窗补充）';
    fields.append(nameRow, valueInput);

    // —— 次级：归到已有字段 ——
    const selRow = document.createElement('div');
    selRow.className = 'jl-t-selrow';
    selRow.hidden = true;
    const sel = existingSelect(customNames);
    const btnTeach = document.createElement('button');
    btnTeach.className = 'jl-t-btn primary';
    btnTeach.textContent = '就是这个字段';
    const btnBack = document.createElement('button');
    btnBack.className = 'jl-t-btn ghost';
    btnBack.textContent = '返回新增';
    selRow.append(sel, btnTeach, btnBack);

    // —— 操作条 ——
    const acts = document.createElement('div');
    acts.className = 'jl-t-acts';
    const btnAdd = document.createElement('button');
    btnAdd.className = 'jl-t-btn primary';
    btnAdd.textContent = '＋ 新增该字段并记住';
    const btnToExisting = document.createElement('button');
    btnToExisting.className = 'jl-t-btn ghost';
    btnToExisting.textContent = '归到已有字段…';
    const btnIgnore = document.createElement('button');
    btnIgnore.className = 'jl-t-btn danger';
    btnIgnore.textContent = '本站忽略';
    const btnSkip = document.createElement('button');
    btnSkip.className = 'jl-t-btn ghost';
    btnSkip.textContent = '跳过';
    acts.append(btnAdd, btnToExisting, btnIgnore, btnSkip);

    const busy = (b: boolean): void => {
      btnAdd.disabled = b;
      btnTeach.disabled = b;
      btnIgnore.disabled = b;
      btnSkip.disabled = b;
      btnToExisting.disabled = b;
    };

    btnAdd.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      busy(true);
      try {
        await handlers.onAddCustom(item, name, valueInput.value.trim());
        processed.add(item.labelKey);
        done(row, '新增');
      } finally {
        busy(false);
      }
    });
    btnToExisting.addEventListener('click', () => {
      fields.hidden = true;
      selRow.hidden = false;
      btnToExisting.hidden = true;
    });
    btnBack.addEventListener('click', () => {
      selRow.hidden = true;
      fields.hidden = false;
      btnToExisting.hidden = false;
    });
    btnTeach.addEventListener('click', async () => {
      if (!sel.value) {
        sel.focus();
        return;
      }
      busy(true);
      try {
        await handlers.onTeach(item, sel.value);
        processed.add(item.labelKey);
        done(row, '归类');
      } finally {
        busy(false);
      }
    });
    btnIgnore.addEventListener('click', async () => {
      busy(true);
      try {
        await handlers.onIgnore(item);
        processed.add(item.labelKey);
        done(row, '忽略');
      } finally {
        busy(false);
      }
    });
    btnSkip.addEventListener('click', () => {
      processed.add(item.labelKey);
      done(row, '跳过');
    });

    row.append(txt);
    if (item.placeholderOnly) {
      const note = document.createElement('div');
      note.className = 'jl-t-note';
      note.textContent = `⚠ 该控件没有字段标签，仅有输入提示词“${item.display}”——字段名请手动填写，不要用提示词充当字段名。`;
      row.appendChild(note);
    }
    row.append(fields, selRow, acts);
    body.appendChild(row);
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.labelKey)) continue;
    seen.add(item.labelKey);
    rowFor(item);
  }
  if (body.childElementCount === 0) {
    const e = document.createElement('div');
    e.className = 'jl-t-empty';
    e.textContent = '暂无可处理的字段';
    body.appendChild(e);
  }
  renderState();

  const cleanup = (): void => {
    host.remove();
  };
  closeBtn.addEventListener('click', () => {
    handlers.onClose();
    cleanup();
  });

  return {
    close: () => {
      handlers.onClose();
      cleanup();
    },
  };
}

export const teachKindText = (kind: string, widget?: string): string => {
  if (kind === 'widget') return widget === 'date' ? '日期选择器' : '下拉选择';
  switch (kind) {
    case 'textarea':
      return '长文本';
    case 'select':
      return '下拉';
    case 'native-date':
      return '原生日期';
    case 'radio':
      return '单选';
    case 'checkbox':
      return '勾选';
    default:
      return '文本';
  }
};

export { fieldZh };
