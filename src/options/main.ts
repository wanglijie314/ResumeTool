/**
 * Options 管理页：
 *  - 我的档案：多副本管理（列表 / 新建 / 设默认 / 重命名 / 删除 + 条目编辑器）
 *  - 学习规则：查看（M3 写入）
 *  - 运行日志：查看 / 导出 / 清空
 *  - 字段体系 / 关于
 */
import './style.css';
import {
  createCopy,
  deleteCopy,
  listCopies,
  renameCopy,
  replaceBlocks,
  replaceCustom,
  replaceEntries,
  setDefaultCopy,
} from '../shared/profile';
import { FIELD_DEFS, FIELD_GROUPS, fieldZh } from '../shared/taxonomy';
import type { FieldKey } from '../shared/taxonomy';
import { appendEvent, clearSessions, endSession, listSessions, sessionsToText, startSession } from '../shared/logger';
import { loadSettings, saveSettings } from '../shared/storage';
import { hasAiConfig, chatJson } from '../shared/aiProvider';
import {
  RESUME_SCALAR_FIELDS,
  RESUME_SCALAR_KEYS,
  buildResumeExtractSystem,
  buildResumeExtractUser,
  decideResumeAdditions,
  parseResumeExtractJson,
} from '../skills/resume-extract';
import type { ResumeAiDecision } from '../skills/resume-extract';
import { listIgnores, listUserWords, removeIgnore, removeWord, upsertWord } from '../shared/learning';
import { experienceKindZh, isExperienceBlockKey, replaceCoarseFromBlocks } from '../shared/blocks';
import { customKeyOfName, customNameOfKey, isCustomKey } from '../shared/keys';
import { experienceRoleLabel, parseResumeText } from '../shared/resumeParser';
import type { ParsedEntry } from '../shared/resumeParser';
import { resumeFileToText } from '../shared/resumeFile';
import type { ExperienceBlock, ProfileCopy, ProfileEntry } from '../shared/types';

interface EditorRow {
  fieldKey: FieldKey;
  value: string;
}

let copiesCache: ProfileCopy[] = [];
let selectedId: string | null = null;
let buffer: EditorRow[] = [];
let dirty = false;
/** 简历导入预览：解析结果先进入可编辑缓冲，用户改完再决定保存方式 */
let importBuffer: EditorRow[] = [];
let importBlocks: ExperienceBlock[] = [];
let importMeta: { name: string; unmatched: string[] } | null = null;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 不存在`);
  return el as T;
};

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/** 字段键展示名：自定义字段（custom:…）还原成用户起的名称 */
function keyLabel(key: string): string {
  return isCustomKey(key) ? customNameOfKey(key) : fieldZh(key);
}

// ---------- 统计 ----------

async function refreshStats(): Promise<void> {
  const words = await listUserWords();
  $('stat-copies').textContent = String(copiesCache.length);
  const total = copiesCache.reduce(
    (n, c) => n + c.entries.length + (c.custom ?? []).length,
    0,
  );
  $('stat-entries').textContent = String(total);
  $('stat-rules').textContent = String(words.length);
}

// ---------- 副本侧栏 ----------

function renderSidebar(): void {
  const ul = $<HTMLUListElement>('copies-list');
  ul.textContent = '';
  for (const c of copiesCache) {
    const li = document.createElement('li');
    li.classList.toggle('selected', c.id === selectedId);
    const name = document.createElement('div');
    name.className = 'cname';
    const nm = document.createElement('span');
    nm.textContent = c.name;
    name.appendChild(nm);
    if (c.isDefault) {
      const b = document.createElement('span');
      b.className = 'badge-def';
      b.textContent = '默认';
      name.appendChild(b);
    }
    const meta = document.createElement('div');
    meta.className = 'cmeta';
    meta.textContent = `${c.entries.length} 条档案 · 更新于 ${fmtTs(c.updatedAt)}`;
    const acts = document.createElement('div');
    acts.className = 'cactions';
    if (!c.isDefault) {
      acts.appendChild(
        actBtn('设为默认', async () => {
          await setDefaultCopy(c.id);
          await loadCopies();
          openEditor(c.id);
        }),
      );
    }
    acts.appendChild(
      actBtn('重命名', async () => {
        const nm = prompt('副本名称', c.name);
        if (nm && nm.trim()) {
          await renameCopy(c.id, nm);
          await loadCopies();
          openEditor(c.id);
        }
      }),
    );
    acts.appendChild(
      actBtn('删除', async () => {
        if (copiesCache.length <= 1) {
          alert('至少保留一份副本');
          return;
        }
        if (!confirm(`删除副本「${c.name}」？其 ${c.entries.length} 条信息将被移除。`)) return;
        await deleteCopy(c.id);
        await loadCopies();
        if (selectedId === c.id) {
          selectedId = copiesCache[0]?.id ?? null;
          if (selectedId) openEditor(selectedId);
        }
      }),
    );
    li.appendChild(name);
    li.appendChild(meta);
    li.appendChild(acts);
    li.addEventListener('click', () => {
      if (dirty && !confirm('当前副本有未保存的修改，放弃并切换？')) return;
      openEditor(c.id);
    });
    ul.appendChild(li);
  }
}

function actBtn(text: string, onClick: () => Promise<void>): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    void onClick();
  });
  return b;
}

async function loadCopies(): Promise<void> {
  copiesCache = await listCopies();
  await refreshStats();
  renderSidebar();
  if (!selectedId || !copiesCache.some((c) => c.id === selectedId)) {
    selectedId = copiesCache[0]?.id ?? null;
  }
}

// ---------- 条目编辑器 ----------

function renderCopyBlocks(): void {
  const host = $<HTMLElement>('entry-rows').parentElement;
  if (!host) return;
  document.getElementById('copy-blocks-view')?.remove();
  const box = document.createElement('div');
  box.id = 'copy-blocks-view';
  const blocks = copyBlocksBuf;
  if (blocks.length > 0) {
    const title = document.createElement('div');
    title.className = 'entry-note';
    title.style.marginTop = '12px';
    title.style.marginBottom = '6px';
    title.style.fontWeight = '600';
    title.textContent = `结构化经历 ${blocks.length} 段（可直接编辑子字段；保存时自动同步“整段文本”）`;
    box.appendChild(title);
    blocks.forEach((b, bi) => {
      const card = document.createElement('div');
      card.className = 'blk';
      const head = document.createElement('div');
      head.className = 'blk-head';
      const label = document.createElement('span');
      label.textContent = `${experienceKindZh(b.kind)} #${bi + 1}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'blk-del';
      del.textContent = '✕';
      del.title = '删除该段';
      del.addEventListener('click', () => {
        if (confirm(`删除「${experienceKindZh(b.kind)} #${bi + 1}」？`)) {
          copyBlocksBuf.splice(bi, 1);
          renderCopyBlocks();
          renderEditorRows();
          markDirty();
        }
      });
      head.append(label, del);
      card.appendChild(head);
      for (const f of b.fields) {
        const rowEl = document.createElement('div');
        rowEl.className = 'blk-field';
        const role = document.createElement('span');
        role.className = 'blk-role';
        role.textContent = experienceRoleLabel(b.kind, f.role);
        const ta = document.createElement('textarea');
        ta.rows = f.role === 'description' ? 4 : 1;
        ta.value = f.value;
        ta.addEventListener('input', () => {
          f.value = ta.value;
          markDirty();
        });
        rowEl.append(role, ta);
        card.appendChild(rowEl);
      }
      box.appendChild(card);
    });
  }
  host.appendChild(box);
}

function openEditor(copyId: string): void {
  if (dirty && selectedId !== copyId && !confirm('当前副本有未保存的修改，放弃并切换？')) return;
  selectedId = copyId;
  const copy = copiesCache.find((c) => c.id === copyId);
  if (!copy) return;
  buffer = copy.entries.map((e) => ({ fieldKey: e.fieldKey, value: e.value }));
  copyBlocksBuf = (copy.blocks ?? []).map((b) => ({
    ...b,
    fields: b.fields.map((f) => ({ ...f })),
  }));
  customBuf = (copy.custom ?? []).map((c) => ({ name: c.name, value: c.value }));
  dirty = false;
  renderEditorHead(copy);
  renderEditorRows();
  renderCustomEditor();
  renderCopyBlocks();
  $('editor-status').textContent = '';
}

interface CustomRow {
  name: string;
  value: string;
}
let customBuf: CustomRow[] = [];
let copyBlocksBuf: ExperienceBlock[] = [];

/** 自定义字段编辑器：名字即身份（如 “居住城市”），保存到副本 custom 列表 */
function renderCustomEditor(): void {
  const box = $<HTMLDivElement>('custom-rows');
  const empty = $<HTMLDivElement>('custom-empty');
  box.textContent = '';
  empty.hidden = customBuf.length > 0;
  customBuf.forEach((row, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'entry-row';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'field-name';
    nameInput.placeholder = '字段名，如：居住城市';
    nameInput.value = row.name;
    nameInput.addEventListener('input', () => {
      row.name = nameInput.value;
      markDirty();
    });
    nameInput.addEventListener('blur', () => {
      const dup = customBuf.findIndex(
        (r, i) => i !== idx && r.name.trim() && r.name.trim() === row.name.trim(),
      );
      if (dup >= 0) {
        alert(`自定义字段名“${row.name.trim()}”已存在`);
        customBuf.splice(idx, 1);
        renderCustomEditor();
      }
    });
    const ta = document.createElement('textarea');
    ta.rows = 2;
    ta.placeholder = '填写该字段的值，如：北京';
    ta.value = row.value;
    ta.addEventListener('input', () => {
      row.value = ta.value;
      markDirty();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = '✕';
    del.title = '删除该自定义字段';
    del.addEventListener('click', () => {
      customBuf.splice(idx, 1);
      renderCustomEditor();
      markDirty();
    });
    wrap.append(nameInput, ta, del);
    box.appendChild(wrap);
  });
}

function renderEditorHead(copy: ProfileCopy): void {
  const head = $('editor-head');
  head.textContent = '';
  const nm = document.createElement('span');
  nm.textContent = copy.name;
  const sub = document.createElement('span');
  sub.className = 'sub';
  const customCount = (copy.custom ?? []).length;
  sub.textContent = `  ·  内置 ${copy.entries.length} 条 · 自定义 ${customCount} 个${copy.isDefault ? '  ·  (默认副本)' : ''}`;
  head.appendChild(nm);
  head.appendChild(sub);
}

function selectFor(def: FieldKey): HTMLSelectElement {
  const sel = document.createElement('select');
  for (const d of FIELD_DEFS) {
    const opt = document.createElement('option');
    opt.value = d.key;
    opt.textContent = `${d.zh}${d.sensitive ? ' 🔒' : ''}`;
    sel.appendChild(opt);
  }
  sel.value = def;
  return sel;
}

function renderEditorRows(): void {
  const box = $<HTMLDivElement>('entry-rows');
  box.textContent = '';
  const blockKinds = new Set(copyBlocksBuf.map((b) => b.kind));
  // 有结构化经历的大类：整段行不再重复显示（结构化区编辑并自动同步整段）
  const visible = buffer
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => !(isExperienceBlockKey(row.fieldKey) && blockKinds.has(row.fieldKey)));
  if (visible.length === 0) {
    const d = document.createElement('div');
    d.className = 'entry-empty';
    d.textContent =
      copyBlocksBuf.length > 0
        ? '本副本的经历以“结构化经历”编辑（见下方各段卡片）；上方可添加内置标量字段，或点击「＋ 添加字段/自定义字段」。'
        : '本副本还没有档案条目。点「添加字段」开始维护，或在页面上用「扫描并填写」就地补充。';
    box.appendChild(d);
  } else {
    for (const { row, idx } of visible) box.appendChild(entryRowEl(row, idx));
  }
  const note = document.createElement('div');
  note.className = 'entry-note';
  note.textContent = '提示：有结构化经历的大类，其“整段文本”会在保存时根据下方结构化段自动生成，无需手工维护整段。';
  box.appendChild(note);
}

function entryRowEl(row: EditorRow, idx: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'entry-row';

  const sel = selectFor(row.fieldKey);
  sel.addEventListener('change', () => {
    const dup = buffer.findIndex(
      (r, i) => i !== idx && r.fieldKey === sel.value,
    );
    if (dup >= 0) {
      alert(`已存在字段「${fieldZh(sel.value as FieldKey)}」，请先在下面删除重复行`);
      sel.value = row.fieldKey;
      return;
    }
    row.fieldKey = sel.value as FieldKey;
    markDirty();
  });
  const def = FIELD_DEFS.find((d) => d.key === row.fieldKey);
  const ta = document.createElement('textarea');
  ta.rows = def && (def.valueType === 'longtext' || def.valueType === 'multi-value') ? 4 : 2;
  ta.placeholder = `输入「${def?.zh ?? row.fieldKey}」的值`;
  ta.value = row.value;
  ta.addEventListener('input', () => {
    row.value = ta.value;
    markDirty();
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'del';
  del.textContent = '✕';
  del.title = '删除该条';
  del.addEventListener('click', () => {
    buffer.splice(idx, 1);
    renderEditorRows();
    markDirty();
  });

  wrap.appendChild(sel);
  wrap.appendChild(ta);
  wrap.appendChild(del);
  return wrap;
}

function markDirty(): void {
  dirty = true;
  const st = $('editor-status');
  st.textContent = '有未保存的修改';
  st.style.color = '#b45309';
}

async function saveEditor(): Promise<void> {
  const copyId = selectedId;
  if (!copyId) return;
  const rawEntries = buffer
    .filter((r) => r.value.trim() !== '')
    .map((r) => ({ fieldKey: r.fieldKey, value: r.value, updatedAt: Date.now(), source: 'user' as const }));
  // 用结构化经历自动重算各“整段”粗字段
  const entries = replaceCoarseFromBlocks(rawEntries, copyBlocksBuf);
  const customs = customBuf
    .filter((r) => r.name.trim() !== '' && r.value.trim() !== '')
    .map((r) => ({ name: r.name.trim(), value: r.value, updatedAt: Date.now() }));
  await replaceEntries(copyId, entries);
  await replaceBlocks(copyId, copyBlocksBuf);
  await replaceCustom(copyId, customs);
  await loadCopies();
  openEditor(copyId);
  const st = $('editor-status');
  st.textContent = `已保存 ${fmtTs(Date.now())}（内置 ${entries.length} 条 · 自定义 ${customs.length} 个 · 经历段 ${copyBlocksBuf.length}）`;
  st.style.color = '#15803d';
}

// ---------- 词表管理 / 字段体系 / 日志 ----------

function wordRowHtml(w: {
  id: string;
  labelKey: string;
  fieldKey: string;
  source: 'taught' | 'alias';
  hits: number;
}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'word-row';
  const src = document.createElement('span');
  src.className = `word-src ${w.source}`;
  src.textContent = w.source === 'taught' ? '教学' : '别名';
  const text = document.createElement('span');
  text.className = 'word-text';
  text.textContent = w.labelKey;
  const arrow = document.createElement('span');
  arrow.className = 'word-arrow';
  arrow.textContent = '→';
  const to = document.createElement('span');
  to.className = 'word-to';
  to.textContent = keyLabel(w.fieldKey);
  const meta = document.createElement('span');
  meta.className = 'word-meta';
  meta.textContent = `全局生效 · 命中 ${w.hits} 次`;
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'word-del';
  del.textContent = '✕';
  del.title = '删除该词条';
  del.addEventListener('click', async () => {
    if (confirm(`删除词条“${w.labelKey}”（将不再自动识别该叫法）？`)) {
      await removeWord(w.id);
      await renderWordsManager();
      await refreshStats();
    }
  });
  row.append(src, text, arrow, to, meta, del);
  return row;
}

async function renderWordsManager(): Promise<void> {
  const sel = $<HTMLSelectElement>('alias-field');
  sel.textContent = '';
  for (const d of FIELD_DEFS) {
    const o = document.createElement('option');
    o.value = d.key;
    o.textContent = `${d.zh}${d.sensitive ? ' 🔒' : ''}`;
    sel.appendChild(o);
  }
  // 别名同样可指到“自定义字段”
  const copies = await listCopies();
  const customNames = [...new Set(copies.flatMap((c) => (c.custom ?? []).map((x) => x.name)))];
  if (customNames.length) {
    const og = document.createElement('optgroup');
    og.label = '我的自定义字段';
    for (const nm of customNames) {
      const o = document.createElement('option');
      o.value = customKeyOfName(nm);
      o.textContent = `${nm}（自定义）`;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  sel.value = 'school';

  const [words, ignores] = await Promise.all([listUserWords(), listIgnores()]);
  $('words-count').textContent = `（${words.length} 条）`;
  $('ignores-count').textContent = `（${ignores.length} 条）`;

  const wordsBox = $<HTMLDivElement>('words-list');
  wordsBox.textContent = '';
  if (words.length === 0) {
    const e = document.createElement('div');
    e.className = 'words-empty';
    e.textContent = '暂无词条。可在页面上用「教学」把没见过的字段教给扩展，或在下表登记别名。';
    wordsBox.appendChild(e);
  } else {
    const sorted = [...words].sort((a, b) => keyLabel(a.fieldKey).localeCompare(keyLabel(b.fieldKey), 'zh'));
    for (const w of sorted) wordsBox.appendChild(wordRowHtml(w));
  }

  const igBox = $<HTMLDivElement>('ignores-list');
  igBox.textContent = '';
  if (ignores.length === 0) {
    const e = document.createElement('div');
    e.className = 'words-empty';
    e.textContent = '暂无站点忽略记录。';
    igBox.appendChild(e);
  } else {
    for (const ig of ignores) {
      const row = document.createElement('div');
      row.className = 'word-row';
      const src = document.createElement('span');
      src.className = 'word-src alias';
      src.textContent = '忽略';
      const text = document.createElement('span');
      text.className = 'word-text';
      text.textContent = ig.labelKey;
      const meta = document.createElement('span');
      meta.className = 'word-meta';
      meta.textContent = `仅站点 ${ig.domain}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'word-del';
      del.textContent = '✕';
      del.addEventListener('click', async () => {
        await removeIgnore(ig.id);
        await renderWordsManager();
      });
      row.append(src, text, meta, del);
      igBox.appendChild(row);
    }
  }
}

async function renderTaxonomyPreview(): Promise<void> {
  const groupsBox = document.getElementById('taxonomy-groups');
  if (!groupsBox) return;
  for (const g of FIELD_GROUPS) {
    const defs = FIELD_DEFS.filter((d) => d.group === g.key);
    const card = document.createElement('div');
    card.className = 'group-card';
    const h = document.createElement('h4');
    h.textContent = `${g.zh}（${defs.length}）`;
    const ul = document.createElement('ul');
    for (const d of defs) {
      const li = document.createElement('li');
      li.textContent = d.sensitive ? `${d.zh} 🔒` : d.zh;
      ul.appendChild(li);
    }
    card.appendChild(h);
    card.appendChild(ul);
    groupsBox.appendChild(card);
  }
}

async function renderLogs(): Promise<void> {
  const box = document.getElementById('logs-list');
  if (!box) return;
  const count = document.getElementById('logs-count');
  const sessions = await listSessions();
  if (count) count.textContent = `（${sessions.length} 个会话）`;
  box.textContent = '';
  if (sessions.length === 0) {
    const d = document.createElement('div');
    d.className = 'logs-empty';
    d.textContent = '暂无日志。打开任意招聘页面后，内容脚本的启动与扫描会自动记录在这里。';
    box.appendChild(d);
    return;
  }
  for (const s of sessions) {
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    const badge = document.createElement('span');
    badge.className = 'log-badge';
    badge.textContent =
      s.source === 'content' ? '页面' : s.source === 'background' ? '后台' : s.source === 'ai' ? 'AI' : '扩展';
    const meta = document.createElement('span');
    meta.className = 'log-meta';
    meta.textContent = `${fmtTs(s.startedAt)} · ${s.events.length} 条${s.source === 'ai' && s.title ? ' · ' + s.title : ''}${s.url ? ' · ' + s.url : ''}`;
    sum.appendChild(badge);
    sum.appendChild(meta);
    const pre = document.createElement('pre');
    pre.textContent = logSessionText(s);
    det.appendChild(sum);
    det.appendChild(pre);
    box.appendChild(det);
  }
}

function logSessionText(s: {
  startedAt: number;
  endAt?: number;
  url?: string;
  title?: string;
  events: { ts: number; level: string; msg: string; data?: unknown }[];
}): string {
  const lines = [`开始 ${fmtTs(s.startedAt)}${s.endAt ? ` · 结束 ${fmtTs(s.endAt)}` : ''}`];
  if (s.url) lines.push(`页面 ${s.url}`);
  if (s.title) lines.push(`标题 ${s.title}`);
  for (const e of s.events) {
    const t = new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false });
    const d = e.data !== undefined ? ` | data=${JSON.stringify(e.data)}` : '';
    lines.push(`[${t}] [${e.level}] ${e.msg}${d}`);
  }
  return lines.join('\n');
}

// ---------- AI 简历补全 ----------

/**
 * 把规则解析遗漏的部分交给模型补齐（无 Key 配置时直接返回空，纯规则流程不受影响）。
 * 返回的 decisions 只代表“建议”，由调用方以可编辑草稿进入预览，落副本前用户可改可删。
 *
 * 全程打印流程日志（与通道内请求事件共用同一条 ai 会话，选项页「运行日志」可见）：
 * 开始（文件名/遗漏行数/已解析字段数）→ 请求发起/成功或失败（通道内）→ 完成（新增/修正/忽略 + 耗时）。
 */
async function aiSupplementFor(
  text: string,
  parsed: readonly { fieldKey: string; value: string }[],
  unmatchedCount: number,
  fileName: string,
): Promise<{ decisions: ResumeAiDecision[]; dropped: number }> {
  const settings = await loadSettings();
  if (!hasAiConfig(settings)) return { decisions: [], dropped: 0 };

  let sessionId: string | undefined;
  try {
    sessionId = await startSession({
      source: 'ai',
      title: 'AI 调用：简历解析补全(resume-extract)',
    });
  } catch {
    sessionId = undefined;
  }
  const app = async (level: 'info' | 'error', msg: string, data?: unknown): Promise<void> => {
    if (!sessionId) return;
    try {
      await appendEvent(sessionId, level, msg, data);
    } catch {
      /* 日志失败不影响流程 */
    }
  };
  const done = async (): Promise<void> => {
    if (!sessionId) return;
    try {
      await endSession(sessionId);
    } catch {
      /* ignore */
    }
  };

  const t0 = Date.now();
  await app('info', `简历 AI 补全开始：${fileName}`, {
    unmatchedCount,
    parsedCount: parsed.length,
    textChars: text.length,
  });
  try {
    const raw = await chatJson(
      settings,
      {
        system: buildResumeExtractSystem(RESUME_SCALAR_FIELDS),
        user: buildResumeExtractUser(text, parsed),
      },
      180_000,
      '简历解析补全(resume-extract)',
      sessionId,
    );
    const additions = parseResumeExtractJson(raw, RESUME_SCALAR_KEYS);
    const out = decideResumeAdditions(parsed, additions);
    const added = out.decisions.filter((d) => d.kind === 'added').length;
    const overridden = out.decisions.length - added;
    await app(
      'info',
      `简历 AI 补全完成：新增 ${added} · 修正 ${overridden} · 低把握忽略 ${out.dropped}（耗时 ${Date.now() - t0}ms）`,
      { added, overridden, dropped: out.dropped, ms: Date.now() - t0 },
    );
    await done();
    return out;
  } catch (e) {
    const code =
      e instanceof Error && 'code' in e ? ` (${String((e as { code?: string }).code ?? '')})` : '';
    await app(
      'error',
      `简历 AI 补全失败${code}：${e instanceof Error ? e.message : String(e)}（已退回规则结果）`,
    );
    await done();
    throw e;
  }
}

// ---------- 简历导入（解析后可编辑，再另存/合并） ----------

function importStatusEl(): HTMLElement {
  return $('import-status');
}

function setImportStatus(text: string, isErr = false): void {
  const el = importStatusEl();
  el.textContent = text;
  el.classList.toggle('err', isErr);
}

/** 可编辑行：字段下拉 + 值文本框 + 删除 */
function importRowEl(row: EditorRow, idx: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'entry-row';

  const sel = selectFor(row.fieldKey);
  sel.addEventListener('change', () => {
    const dup = importBuffer.findIndex((r, i) => i !== idx && r.fieldKey === sel.value);
    if (dup >= 0) {
      alert(`已存在字段「${fieldZh(sel.value as FieldKey)}」，请先删除下面那行`);
      sel.value = row.fieldKey;
      return;
    }
    row.fieldKey = sel.value as FieldKey;
    const d2 = FIELD_DEFS.find((d) => d.key === row.fieldKey);
    ta.rows = d2 && (d2.valueType === 'longtext' || d2.valueType === 'multi-value') ? 4 : 2;
    ta.placeholder = `输入「${d2?.zh ?? row.fieldKey}」的值`;
  });
  const def = FIELD_DEFS.find((d) => d.key === row.fieldKey);
  const ta = document.createElement('textarea');
  ta.rows = def && (def.valueType === 'longtext' || def.valueType === 'multi-value') ? 4 : 2;
  ta.placeholder = `输入「${def?.zh ?? row.fieldKey}」的值（可编辑解析结果）`;
  ta.value = row.value;
  ta.addEventListener('input', () => {
    row.value = ta.value;
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'del';
  del.textContent = '✕';
  del.title = '删除该行';
  del.addEventListener('click', () => {
    importBuffer.splice(idx, 1);
    renderImportRows();
  });

  wrap.appendChild(sel);
  wrap.appendChild(ta);
  wrap.appendChild(del);
  return wrap;
}

function renderImportRows(): void {
  const box = $<HTMLDivElement>('import-rows');
  box.textContent = '';
  if (!importMeta) return;
  const blockKinds = new Set(importBlocks.map((b) => b.kind));
  const visible = importBuffer
    .map((row, idx) => ({ row, idx }))
    .filter(
      ({ row }) => !(isExperienceBlockKey(row.fieldKey) && blockKinds.has(row.fieldKey)),
    );
  if (visible.length === 0) {
    const d = document.createElement('div');
    d.className = 'entry-empty';
    d.textContent = '没有需手工维护的标量字段；经历以“结构化经历拆解”编辑（下方）。点击「＋ 添加字段」可补标量。';
    box.appendChild(d);
  } else {
    for (const { row, idx } of visible) box.appendChild(importRowEl(row, idx));
  }
  const warn =
    importMeta.unmatched.length > 0
      ? ` ｜ 另有 ${importMeta.unmatched.length} 行未能自动归类，例如：${importMeta.unmatched
          .slice(0, 3)
          .map((l) => `“${l.slice(0, 18)}”`)
          .join('、')}`
      : '';
  const hiddenCoarse = importBuffer.length - visible.length;
  setImportStatus(
    `解析出 ${importBuffer.length} 项（经历类已拆到下方结构化区${hiddenCoarse ? `，隐藏 ${hiddenCoarse} 行整段重复` : ''}），可修改后再保存${warn}`,
  );
}

function openImportPanel(
  meta: { name: string; unmatched: string[] },
  entries: ParsedEntry[],
  blocks: ExperienceBlock[],
): void {
  importMeta = meta;
  importBuffer = entries.map((e) => ({ fieldKey: e.fieldKey, value: e.value }));
  importBlocks = blocks.map((b) => ({
    ...b,
    fields: b.fields.map((f) => ({ ...f })),
  }));
  $<HTMLElement>('import-panel').hidden = false;
  $('import-name').textContent = `「${meta.name}」`;
  renderImportRows();
  renderImportBlocks();
  $<HTMLElement>('import-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeImportPanel(): void {
  $<HTMLElement>('import-panel').hidden = true;
  importBuffer = [];
  importBlocks = [];
  importMeta = null;
}

/** 结构化经历块（可编辑子字段值；删除整块） */
function renderImportBlocks(): void {
  const wrap = $<HTMLElement>('import-blocks-wrap');
  const box = $<HTMLDivElement>('import-blocks');
  box.textContent = '';
  wrap.hidden = importBlocks.length === 0;
  importBlocks.forEach((block, bi) => {
    const wrap2 = document.createElement('div');
    wrap2.className = 'blk';
    const head = document.createElement('div');
    head.className = 'blk-head';
    const label = document.createElement('span');
    label.textContent = `${fieldZh(block.kind)} #${bi + 1}`;
    const origin = document.createElement('span');
    origin.className = 'origin';
    origin.textContent = block.heading ? `原句：${block.heading}` : '';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'blk-del';
    del.textContent = '✕';
    del.title = '删除该段经历';
    del.addEventListener('click', () => {
      importBlocks.splice(bi, 1);
      renderImportBlocks();
    });
    head.append(label, origin, del);
    wrap2.appendChild(head);
    for (const f of block.fields) {
      const row = document.createElement('div');
      row.className = 'blk-field';
      const role = document.createElement('span');
      role.className = 'blk-role';
      role.textContent = experienceRoleLabel(block.kind, f.role);
      const ta = document.createElement('textarea');
      ta.rows = f.role === 'description' ? 3 : 1;
      ta.value = f.value;
      ta.addEventListener('input', () => {
        f.value = ta.value;
      });
      row.append(role, ta);
      wrap2.appendChild(row);
    }
    box.appendChild(wrap2);
  });
}

/** 把可编辑缓冲转成档案条目：空行丢弃、同名键保留最后一行，返回去重后条目与丢弃数 */
function currentImportEntries(): { entries: ProfileEntry[]; dropped: number } {
  const map = new Map<FieldKey, ProfileEntry>();
  let dropped = 0;
  for (const r of importBuffer) {
    const v = r.value.trim();
    if (!v) {
      dropped++;
      continue;
    }
    if (map.has(r.fieldKey)) dropped++;
    map.set(r.fieldKey, {
      fieldKey: r.fieldKey,
      value: v,
      updatedAt: Date.now(),
      source: 'user',
    });
  }
  return { entries: [...map.values()], dropped };
}

async function doImportNewCopy(): Promise<void> {
  if (!importMeta) return;
  const { entries, dropped } = currentImportEntries();
  if (entries.length === 0) {
    alert('没有可保存的字段（请先填写至少一行）');
    return;
  }
  const finalEntries = replaceCoarseFromBlocks(entries, importBlocks);
  const name =
    (importMeta.name || '简历副本').replace(/\.(pdf|docx|txt|md)$/i, '') || '简历副本';
  const copy = await createCopy(name);
  await replaceEntries(copy.id, finalEntries);
  if (importBlocks.length) await replaceBlocks(copy.id, importBlocks);
  await loadCopies();
  openEditor(copy.id);
  const st = $('editor-status');
  st.textContent = `已从简历创建副本「${copy.name}」（${finalEntries.length} 项${importBlocks.length ? ` + ${importBlocks.length} 段结构化经历` : ''}${dropped ? `，忽略空/重复 ${dropped} 行` : ''}）`;
  st.style.color = '#15803d';
  closeImportPanel();
}

async function doImportMerge(): Promise<void> {
  if (!importMeta) return;
  const { entries, dropped } = currentImportEntries();
  if (entries.length === 0) {
    alert('没有可合并的字段（请先填写至少一行）');
    return;
  }
  const fresh = await listCopies();
  const target = fresh.find((c) => c.id === selectedId) ?? fresh.find((c) => c.isDefault);
  if (!target) {
    alert('没有可用副本');
    return;
  }
  const merged = new Map<ProfileEntry['fieldKey'], ProfileEntry>();
  for (const e of target.entries) merged.set(e.fieldKey, e);
  for (const e of entries) merged.set(e.fieldKey, e);
  // 经历块：导入含的大类替换旧块，未涉及的大类保留
  const finalBlocks =
    importBlocks.length > 0
      ? [
          ...(target.blocks ?? []).filter(
            (b) => !new Set(importBlocks.map((x) => x.kind)).has(b.kind),
          ),
          ...importBlocks,
        ]
      : target.blocks ?? [];
  await replaceBlocks(target.id, finalBlocks);
  // 用最终结构化经历重算“整段”粗字段
  const finalMerged = replaceCoarseFromBlocks([...merged.values()], finalBlocks);
  await replaceEntries(target.id, finalMerged);
  await loadCopies();
  openEditor(target.id);
  const st = $('editor-status');
  st.textContent = `已把简历合并进「${target.name}」（共 ${finalMerged.length} 项${importBlocks.length ? `，更新 ${importBlocks.length} 段结构化经历` : ''}${dropped ? `，忽略空/重复 ${dropped} 行` : ''}；简历字段覆盖同名旧值）`;
  st.style.color = '#15803d';
  closeImportPanel();
}

/** AI 设置页签顶部状态徽标：按当前输入框内容即时判定 */
function renderAiChip(): void {
  const el = $('ai-state');
  const url = $<HTMLInputElement>('set-ai-url').value.trim();
  const model = $<HTMLInputElement>('set-ai-model').value.trim();
  const key = $<HTMLInputElement>('set-ai-key').value.trim();
  const on = Boolean(url && model && key);
  el.classList.toggle('on', on);
  el.classList.toggle('off', !on);
  el.textContent = on
    ? `已启用：${model}（页面 AI 建议 + 简历 AI 补全；清空 Key 保存即退回内置算法）`
    : '未启用 · 使用内置算法识别与解析，不发送任何内容';
}

/**
 * 上传简历主流程：读取文本 → 规则解析 → 若已配置 AI 且存在遗漏行则自动补全（不弹确认，
 * 结果以可编辑草稿并入预览）→ 打开预览。任何一步失败都退回规则结果，不阻塞导入。
 */
async function importResumeFile(file: File): Promise<void> {
  setImportStatus('正在读取与解析…（PDF 可能需要几秒）');
  $('import-name').textContent = `「${file.name}」`;
  $('import-rows').textContent = '';
  let text: string;
  try {
    text = await resumeFileToText(file);
  } catch (e) {
    setImportStatus(`读取失败：${e instanceof Error ? e.message : String(e)}`, true);
    closeImportPanel();
    return;
  }
  if (!text.trim()) {
    setImportStatus('未能从文件中提取到文本（可能是扫描版 PDF，需要 OCR 或手动填写）', true);
    return;
  }

  const result = parseResumeText(text);
  const settings = await loadSettings();
  const aiOn = hasAiConfig(settings);

  let decisions: ResumeAiDecision[] = [];
  let aiDropped = 0;
  let aiNote = '';
  if (aiOn) {
    setImportStatus('规则解析完成，AI 补全中…（会发送简历片段与上下文给模型）');
    try {
      const out = await aiSupplementFor(text, result.entries, result.unmatched.length, file.name);
      decisions = out.decisions;
      aiDropped = out.dropped;
    } catch (e) {
      aiNote = `AI 补全失败：${e instanceof Error ? e.message : String(e)}（已退回规则结果）`;
    }
  }

  openImportPanel({ name: file.name, unmatched: result.unmatched }, result.entries, result.blocks);

  if (decisions.length > 0) {
    const added = decisions.filter((d) => d.kind === 'added');
    const overridden = decisions.filter((d) => d.kind === 'overridden');
    for (const d of overridden) {
      const row = importBuffer.find((r) => r.fieldKey === d.key);
      if (row) row.value = d.value;
    }
    for (const d of added) importBuffer.push({ fieldKey: d.key as FieldKey, value: d.value });
    renderImportRows();
    if (importBuffer.length === 0 && result.blocks.length === 0) {
      setImportStatus('规则与 AI 都未解析出可用内容。可改用 .txt/.docx，或点「添加字段」手工整理。', true);
      return;
    }
    setImportStatus(
      `规则解析 ${result.entries.length} 项 + AI 补全 ${decisions.length} 项（新增 ${added.length}，修正 ${overridden.length}${
        aiDropped ? `，低把握忽略 ${aiDropped} 项` : ''
      }）——均为可编辑草稿，确认后再另存/合并${aiNote ? ` ｜ ${aiNote}` : ''}`,
    );
    return;
  }

  if (result.entries.length === 0 && result.blocks.length === 0) {
    setImportStatus('未解析出可用内容。可改用 .txt/.docx，或点「添加字段」手工整理。', true);
    return;
  }
  if (aiNote) {
    const warn =
      result.unmatched.length > 0
        ? ` ｜ 另有 ${result.unmatched.length} 行未能自动归类，例如：${result.unmatched
            .slice(0, 3)
            .map((l) => `“${l.slice(0, 18)}”`)
            .join('、')}`
        : '';
    setImportStatus(`规则解析 ${result.entries.length} 项${warn}${aiNote ? ` ｜ ${aiNote}` : ''}`);
  }
}

// ---------- 启动 ----------

async function main(): Promise<void> {
  await loadCopies();
  if (selectedId) openEditor(selectedId);

  $('btn-copy-new').addEventListener('click', async () => {
    const name = prompt('新副本名称（如：校招A / 社招B）', '新副本');
    if (!name) return;
    const fromDefault = confirm('复制当前默认副本的内容作为起点？\n（取消 = 创建空副本）');
    const def = copiesCache.find((c) => c.isDefault);
    const copy = await createCopy(name, fromDefault && def ? def.id : undefined);
    await loadCopies();
    openEditor(copy.id);
  });
  $('btn-entry-add').addEventListener('click', () => {
    if (!selectedId) return;
    buffer.push({ fieldKey: 'name', value: '' });
    renderEditorRows();
    markDirty();
  });
  $('btn-custom-add').addEventListener('click', () => {
    customBuf.push({ name: '', value: '' });
    renderCustomEditor();
    markDirty();
  });
  $('btn-editor-save').addEventListener('click', () => {
    void saveEditor();
  });

  // —— 简历上传解析 ——
  const fileInput = $<HTMLInputElement>('file-resume');
  $('btn-import-resume').addEventListener('click', () => fileInput.click());
  $('btn-import-cancel').addEventListener('click', closeImportPanel);
  $('btn-import-new').addEventListener('click', () => {
    void doImportNewCopy();
  });
  $('btn-import-merge').addEventListener('click', () => {
    void doImportMerge();
  });
  $('btn-import-add').addEventListener('click', () => {
    importBuffer.push({ fieldKey: 'name', value: '' });
    renderImportRows();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    await importResumeFile(file);
  });

  await renderTaxonomyPreview();
  await renderWordsManager();
  $('btn-alias-add').addEventListener('click', async () => {
    const field = $<HTMLSelectElement>('alias-field').value;
    const text = $<HTMLInputElement>('alias-text').value.trim();
    if (!text) {
      alert('请输入页面上的叫法文本');
      return;
    }
    await upsertWord(text, field, 'alias');
    $<HTMLInputElement>('alias-text').value = '';
    await renderWordsManager();
    await refreshStats();
  });

  // —— AI 设置 ——
  const setStatus = $<HTMLSpanElement>('set-status');
  const loadAiSettings = async (): Promise<void> => {
    const s = await loadSettings();
    $<HTMLInputElement>('set-ai-url').value = s.aiBaseUrl;
    $<HTMLInputElement>('set-ai-model').value = s.aiModel;
    $<HTMLInputElement>('set-ai-key').value = s.aiApiKey;
  };
  await loadAiSettings();
  renderAiChip();
  $('btn-set-save').addEventListener('click', async () => {
    await saveSettings({
      aiBaseUrl: $<HTMLInputElement>('set-ai-url').value.trim(),
      aiModel: $<HTMLInputElement>('set-ai-model').value.trim(),
      aiApiKey: $<HTMLInputElement>('set-ai-key').value.trim(),
    });
    renderAiChip();
    setStatus.textContent = `已保存 ${fmtTs(Date.now())}`;
    setStatus.style.color = '#15803d';
  });
  $('btn-set-test').addEventListener('click', async () => {
    await saveSettings({
      aiBaseUrl: $<HTMLInputElement>('set-ai-url').value.trim(),
      aiModel: $<HTMLInputElement>('set-ai-model').value.trim(),
      aiApiKey: $<HTMLInputElement>('set-ai-key').value.trim(),
    });
    renderAiChip();
    setStatus.textContent = '正在测试…';
    setStatus.style.color = '#64748b';
    try {
      const resp = (await chrome.runtime.sendMessage({ type: 'AI_TEST' })) as {
        ok?: boolean;
        error?: string;
      };
      if (resp?.ok) {
        setStatus.textContent = '连接成功 ✅';
        setStatus.style.color = '#15803d';
      } else {
        setStatus.textContent = `失败：${resp?.error ?? '无响应'}`;
        setStatus.style.color = '#b91c1c';
      }
    } catch (e) {
      setStatus.textContent = `失败：${e instanceof Error ? e.message : String(e)}`;
      setStatus.style.color = '#b91c1c';
    }
  });

  await renderLogs();

  document.getElementById('btn-log-refresh')?.addEventListener('click', () => {
    void renderLogs();
  });
  document.getElementById('btn-log-clear')?.addEventListener('click', async () => {
    if (confirm('确定清空全部运行日志？')) {
      await clearSessions();
      await renderLogs();
    }
  });
  document.getElementById('btn-log-export')?.addEventListener('click', async () => {
    const all = await listSessions();
    if (all.length === 0) {
      alert('暂无日志可导出');
      return;
    }
    const text = sessionsToText(all);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `jianli-autofill-logs-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  const tabs = document.getElementById('tabs');
  const pages = Array.from(document.querySelectorAll<HTMLElement>('section.page'));
  tabs?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-page]') as HTMLButtonElement | null;
    if (!btn) return;
    const target = btn.dataset.page;
    for (const b of tabs.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    for (const p of pages) {
      p.style.display = p.dataset.page === target ? '' : 'none';
    }
    if (target === 'logs') void renderLogs();
    if (target === 'rules') void renderWordsManager();
  });
}

void main().catch((e) => console.error('[简历一键填 options] 初始化失败', e));
