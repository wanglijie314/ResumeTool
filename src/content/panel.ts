/**
 * 页内识别结果面板（M1）：展示当前页面扫描识别出的简历字段与置信度。
 * 使用 Shadow DOM 隔离样式，不与被填站点冲突。
 */
import { FIELD_GROUPS } from '../shared/taxonomy';
import { fieldZh, groupZh } from '../shared/taxonomy';
import { truncate } from '../shared/normalize';
import { confidenceLabel } from './dictionary';
import { attachDrag } from './drag';
import type { ClassifiedField } from '../shared/types';

export interface PanelCallbacks {
  onRescan: () => void;
  onToggleFollow: (on: boolean) => void;
  onInspect: (id: string) => void;
  onMinimize: () => void;
  onExpand: () => void;
  /** 用户点 ✕：彻底关闭本页识别面板（后续不再自动弹出） */
  onCloseFull?: () => void;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.jl-wrap {
  font: 12px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #1f2937; position: fixed; right: 14px; top: 14px; z-index: 2147483000;
  width: 330px; max-width: calc(100vw - 28px);
}
.jl-panel {
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.18); overflow: hidden;
  display: flex; flex-direction: column; max-height: min(72vh, 640px);
}
.jl-head {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  background: linear-gradient(135deg, #1d4ed8, #2563eb); color: #fff; cursor: move;
}
.jl-logo { width: 18px; height: 18px; border-radius: 5px; background: #fff; color: #1d4ed8;
  font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; }
.jl-title { font-weight: 600; font-size: 13px; }
.jl-count { font-size: 11px; opacity: 0.9; }
.jl-head-spacer { flex: 1; }
.jl-btn { border: none; background: rgba(255,255,255,0.18); color: #fff; border-radius: 6px;
  padding: 2px 8px; font-size: 12px; cursor: pointer; }
.jl-btn:hover { background: rgba(255,255,255,0.32); }
.jl-body { overflow-y: auto; overscroll-behavior: contain; }
.jl-summary { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; font-size: 12px; color: #475569;
  display: flex; gap: 12px; flex-wrap: wrap; }
.jl-summary b { color: #1e40af; }
.jl-summary .bad { color: #b45309; }
.jl-sec-title { padding: 6px 12px; font-size: 11px; font-weight: 600; color: #64748b;
  background: #f8fafc; border-bottom: 1px solid #f1f5f9; position: sticky; top: 0; }
.jl-row { display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer;
  border-bottom: 1px solid #f8fafc; }
.jl-row:hover { background: #f0f6ff; }
.jl-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.dot-high { background: #16a34a; } .dot-medium { background: #f59e0b; }
.dot-low { background: #facc15; } .dot-unknown { background: #cbd5e1; }
.jl-main { flex: 1; min-width: 0; }
.jl-fieldname { font-weight: 600; color: #0f172a; font-size: 12px; }
.jl-pagetext { color: #94a3b8; font-size: 11px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; max-width: 170px; }
.jl-chip { font-size: 10px; border-radius: 8px; padding: 0 6px; flex: 0 0 auto; }
.chip-high { background: #dcfce7; color: #166534; } .chip-medium { background: #fef3c7; color: #92400e; }
.chip-low { background: #fef9c3; color: #854d0e; } .chip-unknown { background: #f1f5f9; color: #64748b; }
.jl-reason { color: #b6c2d4; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jl-empty { padding: 16px 12px; color: #94a3b8; text-align: center; }
.jl-foot { padding: 6px 12px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8;
  display: flex; align-items: center; gap: 8px; }
.jl-foot label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
/* 收起的悬浮胶囊 */
.jl-pill { display: none; align-items: center; gap: 6px; cursor: pointer;
  background: #1d4ed8; color: #fff; border-radius: 999px; padding: 6px 12px;
  box-shadow: 0 4px 16px rgba(29, 78, 216, 0.35); font-size: 12px; }
.jl-pill:hover { background: #1e40af; }
`;

export class RecogPanel {
  private rootHost: HTMLElement;
  private shadow: ShadowRoot;
  private body: HTMLDivElement;
  private pill: HTMLDivElement;
  private panel: HTMLDivElement;
  private followCheckbox: HTMLInputElement;
  private cb: PanelCallbacks;

  constructor(host: HTMLElement, cb: PanelCallbacks) {
    this.rootHost = host;
    this.cb = cb;
    this.shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'jl-wrap';
    this.shadow.appendChild(wrap);

    // 主面板
    this.panel = document.createElement('div');
    this.panel.className = 'jl-panel';
    const head = document.createElement('div');
    head.className = 'jl-head';
    head.innerHTML =
      '<span class="jl-logo">简</span><span class="jl-title">简历识别</span>' +
      '<span class="jl-count"></span><span class="jl-head-spacer"></span>';
    const btnRescan = this.button('重扫');
    btnRescan.title = '重新扫描当前页面字段';
    btnRescan.addEventListener('click', () => this.cb.onRescan());
    const btnMin = this.button('收起');
    btnMin.title = '收成小胶囊，可再点开';
    btnMin.addEventListener('click', () => {
      this.cb.onMinimize();
      this.hide();
    });
    const btnClose = this.button('✕');
    btnClose.title = '关闭本页识别面板';
    btnClose.addEventListener('click', () => {
      this.cb.onCloseFull?.();
      this.destroy();
    });
    head.appendChild(btnRescan);
    head.appendChild(btnMin);
    head.appendChild(btnClose);
    this.panel.appendChild(head);

    this.body = document.createElement('div');
    this.body.className = 'jl-body';
    this.panel.appendChild(this.body);

    const foot = document.createElement('div');
    foot.className = 'jl-foot';
    this.followCheckbox = document.createElement('input');
    this.followCheckbox.type = 'checkbox';
    this.followCheckbox.checked = true;
    this.followCheckbox.addEventListener('change', () =>
      this.cb.onToggleFollow(this.followCheckbox.checked),
    );
    const label = document.createElement('label');
    label.appendChild(this.followCheckbox);
    label.appendChild(document.createTextNode('自动跟随页面变化'));
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const hint = document.createElement('span');
    hint.textContent = '点击条目可定位页面字段';
    foot.appendChild(label);
    foot.appendChild(spacer);
    foot.appendChild(hint);
    this.panel.appendChild(foot);
    wrap.appendChild(this.panel);

    // 收起后的胶囊
    this.pill = document.createElement('div');
    this.pill.className = 'jl-pill';
    this.pill.innerHTML = '<b>简</b><span class="jl-pill-text">识别</span>';
    this.pill.addEventListener('click', () => {
      this.cb.onExpand();
      this.show();
    });
    wrap.appendChild(this.pill);

    // 面板与胶囊均可拖动（按住标题栏 / 胶囊拖拽）
    attachDrag(head, wrap);
    attachDrag(this.pill, wrap);
  }

  private button(text: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'jl-btn';
    b.textContent = text;
    return b;
  }

  /** 彻底移除本页识别面板（不再自动弹出） */
  destroy(): void {
    this.rootHost.remove();
  }

  setFollow(on: boolean): void {
    this.followCheckbox.checked = on;
  }

  show(): void {
    this.panel.style.display = 'flex';
    this.pill.style.display = 'none';
  }

  hide(): void {
    this.panel.style.display = 'none';
    this.pill.style.display = 'inline-flex';
  }

  /** 渲染扫描结果（每次都整体重建，条目数有限，成本可忽略） */
  render(fields: ClassifiedField[]): void {
    const notIgnored = (f: ClassifiedField) => !f.result.reasons.includes('#ignore#');
    const visible = fields.filter(notIgnored);
    const ignoredCount = fields.length - visible.length;
    const recognized = visible.filter((f) => f.result.fieldKey !== null);
    const unknown = visible.filter((f) => f.result.fieldKey === null);

    const countEl = this.panel.querySelector('.jl-count');
    if (countEl) countEl.textContent = `${recognized.length}/${visible.length}`;
    this.pill.querySelector('.jl-pill-text')!.textContent =
      `识别 ${recognized.length}/${visible.length}`;

    this.body.textContent = '';
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jl-empty';
      empty.textContent =
        fields.length > 0
          ? '本页表单控件均被忽略（验证码/登录/搜索类），无需处理'
          : '未发现可识别的表单控件（若刚进入页面可点“重扫”）';
      this.body.appendChild(empty);
      return;
    }

    const summary = document.createElement('div');
    summary.className = 'jl-summary';
    summary.innerHTML = '';
    const s1 = document.createElement('span');
    s1.innerHTML = `识别 <b>${recognized.length}</b> 项`;
    const s2 = document.createElement('span');
    s2.innerHTML = `<span class="bad">未识别 ${unknown.length}</span> 项（M3 支持“问一次并记住”）`;
    summary.appendChild(s1);
    summary.appendChild(s2);
    if (ignoredCount > 0) {
      const s3 = document.createElement('span');
      s3.textContent = `已忽略 ${ignoredCount} 项`;
      s3.style.color = '#94a3b8';
      summary.appendChild(s3);
    }
    this.body.appendChild(summary);

    // 已识别：按分组顺序输出
    let anyGroup = false;
    for (const group of FIELD_GROUPS) {
      const rows = recognized.filter((f) => f.result.fieldGroup === group.key);
      if (rows.length === 0) continue;
      anyGroup = true;
      this.body.appendChild(this.sectionTitle(`${groupZh(group.key)} (${rows.length})`));
      for (const f of rows) this.body.appendChild(this.row(f));
    }

    // 未识别
    if (unknown.length > 0) {
      if (anyGroup) this.body.appendChild(this.sectionTitle(`未识别/待教学 (${unknown.length})`));
      for (const f of unknown.slice(0, 60)) this.body.appendChild(this.row(f));
    }
  }

  private sectionTitle(text: string): HTMLElement {
    const d = document.createElement('div');
    d.className = 'jl-sec-title';
    d.textContent = text;
    return d;
  }

  private row(f: ClassifiedField): HTMLElement {
    const { candidate, result } = f;
    const row = document.createElement('div');
    row.className = 'jl-row';
    row.title = `页面文本：${candidate.labelText || candidate.placeholder || candidate.name || '(无)'}\n` +
      `识别依据：\n${result.reasons.join('\n') || '—'}`;
    row.addEventListener('click', () => this.cb.onInspect(candidate.id));

    const dot = document.createElement('span');
    const chip = document.createElement('span');
    const main = document.createElement('div');
    main.className = 'jl-main';

    if (result.fieldKey) {
      const nameLine = document.createElement('div');
      nameLine.className = 'jl-fieldname';
      nameLine.textContent = fieldZh(result.fieldKey);
      const pageLine = document.createElement('div');
      pageLine.className = 'jl-pagetext';
      pageLine.textContent = truncate(candidate.labelText || candidate.placeholder || candidate.name || candidate.idAttr, 40);
      main.appendChild(nameLine);
      main.appendChild(pageLine);

      const cl = confidenceLabel(result.confidence);
      dot.className = `jl-dot dot-${cl === '高' ? 'high' : cl === '中' ? 'medium' : 'low'}`;
      chip.className = `jl-chip chip-${cl === '高' ? 'high' : cl === '中' ? 'medium' : 'low'}`;
      chip.textContent = cl;
    } else {
      dot.className = 'jl-dot dot-unknown';
      chip.className = 'jl-chip chip-unknown';
      chip.textContent = '未识别';
      const nameLine = document.createElement('div');
      nameLine.className = 'jl-fieldname';
      nameLine.style.color = '#94a3b8';
      nameLine.textContent = truncate(candidate.labelText || candidate.placeholder || candidate.name || '(无名控件)', 40);
      const reasonLine = document.createElement('div');
      reasonLine.className = 'jl-reason';
      reasonLine.textContent = truncate(result.reasons.join('；'), 60);
      main.appendChild(nameLine);
      main.appendChild(reasonLine);
    }

    row.appendChild(dot);
    row.appendChild(main);
    row.appendChild(chip);
    return row;
  }
}
