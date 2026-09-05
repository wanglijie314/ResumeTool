/**
 * Popup 主逻辑：
 *  - 「扫描并填写」：连接当前页 → 取默认副本 → 快照识别字段 →
 *    已有值(绿) 将填写；副本没有的(橙) 提供输入框就地补充并持久化到默认副本；
 *    副本有但页面没有的 → 提示"不填"。
 *  - 「信息副本」：新建/设为默认/重命名/删除副本；内容编辑在完整管理页。
 */
import './style.css';
import {
  createCopy,
  deleteCopy,
  getDefaultCopy,
  listCopies,
  renameCopy,
  setDefaultCopy,
  surplusKeys,
  upsertCustom,
  upsertEntry,
  valueMapOf,
} from '../shared/profile';
import { customNameOfKey, isCustomKey } from '../shared/keys';
import { SENSITIVE_KEYS, fieldZh } from '../shared/taxonomy';
import type { FieldKey } from '../shared/taxonomy';
import type { FillReport, ProfileCopy, SnapshotData, SnapshotField } from '../shared/types';

/** 字段键展示名：自定义键还原为用户起的名字 */
export function fieldLabel(key: string): string {
  return isCustomKey(key) ? customNameOfKey(key) : fieldZh(key);
}

/** 与 content/index.ts 中 FILL_MIN_CONF 保持一致（CONF.medium） */
const FILL_MIN_CONF = 0.6;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 不存在`);
  return el as T;
};

let activeTabId: number | null = null;
let lastSnapshot: SnapshotData | null = null;
let lastCopy: ProfileCopy | undefined;

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function sendToTab<T>(tabId: number, msg: Record<string, unknown>): Promise<T> {
  return (await chrome.tabs.sendMessage(tabId, msg)) as T;
}

type ConnectState = 'ok' | 'restricted' | 'inject-failed' | 'no-response' | 'stale-extension';

/** 连接当前页内容脚本：优先 PING；失败则补注入（仅 http/https/file 页），再轮询等待 */
async function connectTab(tabId: number, url: string): Promise<ConnectState> {
  try {
    await sendToTab(tabId, { type: 'PING' });
    return 'ok';
  } catch {
    /* 未存活 → 尝试注入 */
  }
  if (url && !/^(https?|file):/i.test(url)) return 'restricted';
  const entry = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0];
  if (!entry) return 'no-response';
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [entry] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[简历一键填] 内容脚本注入失败:', msg);
    // 运行中的扩展清单指向的 loader 文件在磁盘上已不存在 → 扩展版本滞后于构建产物
    if (/Could not load file/i.test(msg)) return 'stale-extension';
    return 'inject-failed';
  }
  for (let i = 0; i < 8; i++) {
    try {
      await sendToTab(tabId, { type: 'PING' });
      return 'ok';
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return 'no-response';
}

function setMsg(text: string, isErr = false): void {
  const m = $<HTMLDivElement>('msg');
  m.textContent = text;
  m.classList.toggle('err', isErr);
  m.hidden = !text;
}

const trunc = (s: string, n = 46): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function kindText(f: SnapshotField): string {
  if (f.kind === 'widget') return f.widget === 'date' ? '日期选择器' : '下拉选择';
  switch (f.kind) {
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
}

// ---------- 扫描并填写 ----------

function renderFillRows(snapshot: SnapshotData, copy: ProfileCopy): void {
  const rowsBox = $<HTMLDivElement>('rows');
  rowsBox.textContent = '';

  // 可填候选：识别成功且置信度达标、未被忽略
  const candidates = snapshot.fields.filter(
    (f) => f.fieldKey !== null && !f.ignored && f.confidence >= FILL_MIN_CONF,
  );
  // 按 fieldKey 去重（保留置信度最高 / 第一次出现的标签）
  const byKey = new Map<string, SnapshotField>();
  for (const f of candidates) {
    if (!f.fieldKey) continue;
    const cur = byKey.get(f.fieldKey);
    if (!cur || f.confidence > cur.confidence) byKey.set(f.fieldKey, f);
  }
  const recognizedKeys = [...byKey.keys()];
  const have = valueMapOf(copy);
  const surplus = surplusKeys(copy, recognizedKeys);
  const needInputs = new Map<string, HTMLInputElement>();

  // 未识别（可教学）集合
  teachFields = snapshot.fields.filter((f) => f.fieldKey === null && !f.ignored);
  const teachBtn = $<HTMLButtonElement>('btn-teach');
  teachBtn.hidden = teachFields.length === 0;
  teachBtn.textContent = `教学 ${teachFields.length} 个未识别…`;
  const fillBtn = $<HTMLButtonElement>('btn-fill');
  fillBtn.disabled = recognizedKeys.length === 0;
  $('bar-fill').hidden = false;

  if (recognizedKeys.length === 0) {
    const d = document.createElement('div');
    d.className = 'empty-tip';
    d.textContent = `本页没有可填写的已识别字段（控件 ${snapshot.controls}，已识别 ${snapshot.recognized}，未识别 ${snapshot.unknown}，忽略 ${snapshot.ignored}）。\n若存在未识别字段，可用「教学」把它们教给扩展（全局记住）。`;
    rowsBox.appendChild(d);
    $('fill-hint').textContent = teachFields.length ? '点「教学」把未识别字段归类，之后即可自动识别填写。' : '可点「重新扫描」再试。';
    return;
  }

  for (const key of recognizedKeys) {
    const f = byKey.get(key)!;
    const zh = fieldLabel(key);
    const row = document.createElement('div');
    row.className = 'row';
    const head = document.createElement('div');
    head.className = 'row-head';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.className = 'fname';
    name.textContent = zh;
    const page = document.createElement('span');
    page.className = 'pagetext';
    page.textContent = `← ${trunc(f.labelText || f.placeholder || f.name || '(无名)', 24)}`;
    const kt = document.createElement('span');
    kt.className = 'chip';
    kt.textContent = kindText(f);
    const tag = document.createElement('span');
    head.appendChild(dot);
    head.appendChild(name);
    head.appendChild(page);
    head.appendChild(kt);

    const hasVal = have.has(key);
    if (hasVal) {
      dot.classList.add('ok');
      tag.className = 'tag has';
      tag.textContent = '有记录·将填写';
      head.appendChild(tag);
      const pv = document.createElement('div');
      pv.className = 'val-preview';
      pv.textContent = trunc(have.get(key)!, 80);
      row.appendChild(head);
      row.appendChild(pv);
    } else {
      dot.classList.add('need');
      tag.className = 'tag need';
      tag.textContent = SENSITIVE_KEYS.has(key) ? '需补充 🔒' : '需补充';
      head.appendChild(tag);
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = `副本中还没有「${zh}」，可直接输入${SENSITIVE_KEYS.has(key) ? '（敏感信息，仅存本机）' : ''}`;
      needInputs.set(key, inp);
      row.appendChild(head);
      row.appendChild(inp);
    }
    rowsBox.appendChild(row);
  }

  if (surplus.length > 0) {
    const h = document.createElement('div');
    h.className = 'hintline';
    h.textContent = '副本中有、但本页未出现的字段（不填写）：';
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const k of surplus) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = fieldLabel(k);
      chips.appendChild(c);
    }
    rowsBox.appendChild(h);
    rowsBox.appendChild(chips);
  }

  const missingCount = needInputs.size;
  $<HTMLSpanElement>('fill-hint').textContent =
    missingCount > 0
      ? `有 ${missingCount} 个字段副本中没有：填写后保存到「${copy.name}」；留空则本次跳过且不保存。`
      : '副本信息齐全，点击「填写」将只填空项、不覆盖已有内容。';
  const btn = $<HTMLButtonElement>('btn-fill');
  btn.textContent = `填写（${recognizedKeys.length - missingCount} 已有 + ${missingCount} 补充）`;

  // 暂存到全局以便点击填写时读取
  pendingInputs = needInputs;
  pendingKeys = recognizedKeys;
}

let pendingInputs: Map<string, HTMLInputElement> = new Map();
let pendingKeys: string[] = [];
let teachFields: SnapshotField[] = [];

async function doFill(): Promise<void> {
  const copy = lastCopy;
  const snapshot = lastSnapshot;
  const tabId = activeTabId;
  if (!copy || !snapshot || tabId === null) {
    setMsg('缺少上下文（副本/页面快照），请重新打开弹窗', true);
    return;
  }
  const btn = $<HTMLButtonElement>('btn-fill');
  btn.disabled = true;
  try {
    // 1) 就地补充 → 持久化到"当前(默认)副本"（内置字段 / 自定义字段分开写）
    const added: string[] = [];
    for (const [key, inp] of pendingInputs) {
      const v = inp.value.trim();
      if (!v) continue;
      if (isCustomKey(key)) {
        await upsertCustom(copy.id, customNameOfKey(key), v);
      } else {
        await upsertEntry(copy.id, key as FieldKey, v);
      }
      added.push(key);
    }
    // 2) 重新读取默认副本（含刚补充的内容），组装填写目标
    const fresh = await getDefaultCopy();
    if (!fresh) {
      setMsg('无法读取默认副本', true);
      btn.disabled = false;
      return;
    }
    lastCopy = fresh;
    const totalFields = fresh.entries.length + (fresh.custom ?? []).length;
    $<HTMLSpanElement>('copy-chip').textContent = `默认副本：${fresh.name}（${totalFields} 项）`;
    const values = valueMapOf(fresh);
    const targets = pendingKeys
      .filter((k) => values.has(k))
      .map((k) => ({ fieldKey: k, value: values.get(k)! }));

    if (targets.length === 0) {
      setMsg('没有可填写的值（补充栏留空则不会填写）', true);
      btn.disabled = false;
      return;
    }
    // 3) 发送填写指令
    const resp = await sendToTab<{ ok?: boolean; error?: string; report?: FillReport }>(
      tabId,
      { type: 'FILL', targets },
    );
    if (!resp?.ok || !resp.report) {
      setMsg(`填写失败：${resp?.error ?? '无响应'}`, true);
      return;
    }
    const rep = resp.report;
    const lines: string[] = [];
    lines.push(
      `完成：成功填写 ${rep.totalFilled} 处 / 命中 ${rep.totalMatched} 处 / 目标 ${rep.targets} 项`,
    );
    for (const fr of rep.fields) {
      if (fr.matched === 0) lines.push(`· ${fr.zh}：页面未找到对应字段`);
      else if (fr.filled < fr.matched) lines.push(`· ${fr.zh}：填写 ${fr.filled}/${fr.matched}${fr.notices.length ? `（${fr.notices.join('；')}）` : ''}`);
    }
    if (added.length) {
      lines.push(`已把补充的 ${added.length} 项保存到副本「${copy.name}」（不影响其它副本）：${added.map(fieldLabel).join('、')}`);
    }
    setMsg(lines.join('\n'));
    await refreshFill(); // 刷新状态展示
  } catch (e) {
    setMsg(`发生错误：${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    btn.disabled = false;
  }
}

async function refreshFill(): Promise<void> {
  const status = $<HTMLSpanElement>('fill-status');
  setMsg('');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id ?? null;
  const url = tab?.url ?? '';
  activeTabId = tabId;
  if (tabId === null) {
    status.textContent = '无法获取当前标签页';
    return;
  }
  status.textContent = '正在连接页面…';
  const state = await connectTab(tabId, url);
  if (state !== 'ok') {
    $('rows').textContent = '';
    $('bar-fill').hidden = true;
    if (state === 'restricted') {
      status.textContent = '当前为受限页面（chrome://、扩展页等），不支持运行';
    } else if (state === 'stale-extension') {
      status.textContent = '扩展版本与构建产物不一致';
      setMsg('你正在运行的扩展是旧构建：请先在 chrome://extensions 点「简历一键填」的 ↻ 重载按钮，再点图标重试。', true);
    } else if (state === 'inject-failed') {
      status.textContent = '内容脚本注入失败';
      setMsg('请先按 F5 刷新该页面，再点图标重试（扩展重载后旧的已开页面需要刷新才会注入）。仍失败可到扩展「运行日志」查看。', true);
    } else {
      status.textContent = '内容脚本未响应';
      setMsg('脚本已注入但未就绪（可能启动时报错）。请按 F5 刷新后重试；仍不行请查看扩展「运行日志」里的报错。', true);
    }
    return;
  }
  const copy = await getDefaultCopy();
  lastCopy = copy;
  if (copy) $<HTMLSpanElement>('copy-chip').textContent = `默认副本：${copy.name}（${copy.entries.length + (copy.custom ?? []).length} 项）`;
  const resp = await sendToTab<{ ok?: boolean; error?: string; snapshot?: SnapshotData }>(
    tabId,
    { type: 'GET_SNAPSHOT' },
  );
  if (!resp?.ok || !resp.snapshot) {
    status.textContent = '扫描失败';
    setMsg(`快照失败：${resp?.error ?? '无响应'}`, true);
    return;
  }
  lastSnapshot = resp.snapshot;
  const s = resp.snapshot;
  status.textContent = `扫描完成：识别 ${s.recognized} · 未识别 ${s.unknown} · 忽略 ${s.ignored} · 控件 ${s.controls}`;
  // 行组合探测（供“按段填经历”使用）
  try {
    const pr = await sendToTab<{ ok?: boolean; plans?: RowPlanInfo[] }>(tabId, {
      type: 'GET_ROW_PLAN',
    });
    rowPlans = pr?.plans ?? [];
  } catch {
    rowPlans = [];
  }
  if (copy) {
    renderFillRows(s, copy);
    renderRowPlanUI(copy);
  }
}

interface RowPlanInfo {
  kind: string;
  zh: string;
  rows: number;
  add: boolean;
  roles: string[];
}

let rowPlans: RowPlanInfo[] = [];

/** 顶部提示检测到的经历组合 + 启用“按段填经历”按钮 */
function renderRowPlanUI(copy: ProfileCopy): void {
  const btn = $<HTMLButtonElement>('btn-fill-rows');
  const blockCounts = new Map<string, number>();
  for (const b of copy.blocks ?? []) blockCounts.set(b.kind, (blockCounts.get(b.kind) ?? 0) + 1);
  const usable = rowPlans.filter((p) => (blockCounts.get(p.kind) ?? 0) > 0);
  btn.hidden = usable.length === 0;
  if (usable.length) {
    btn.textContent = `按段填经历（${usable.map((u) => `${u.zh}×${blockCounts.get(u.kind)}`).join('、')}）`;
    const rows = $<HTMLDivElement>('rows');
    const banner = document.createElement('div');
    banner.className = 'hintline';
    const detail = usable
      .map((u) => `${u.zh}（页面 ${u.rows} 行${u.add ? '，可添加' : '，无添加按钮'}）`)
      .join('；');
    banner.textContent = `检测到经历多行组合：${detail}。副本中有对应经历段，点「按段填经历」会按顺序填写；行不够时只填到已有行并提示未填完。`;
    rows.insertBefore(banner, rows.firstChild);
  }
}

/** 按默认副本经历段，把页面上的经历组合逐行填完（增行/剩余提醒） */
async function doFillRows(): Promise<void> {
  const copy = lastCopy;
  const tabId = activeTabId;
  if (!copy || tabId === null) {
    setMsg('缺少上下文（副本/页面快照），请重新打开弹窗', true);
    return;
  }
  const blockCounts = new Map<string, number>();
  for (const b of copy.blocks ?? []) blockCounts.set(b.kind, (blockCounts.get(b.kind) ?? 0) + 1);
  const kinds = rowPlans.filter((p) => (blockCounts.get(p.kind) ?? 0) > 0).map((p) => p.kind);
  if (kinds.length === 0) {
    setMsg('没有可填的经历组合（需先有解析出的经历段，或页面未识别到组合）', true);
    return;
  }
  try {
    const resp = await sendToTab<{
      ok?: boolean;
      error?: string;
      items?: { zh: string; filled: number; remaining: number; added: number; warnings: string[] }[];
    }>(tabId, { type: 'FILL_ROWS', kinds });
    if (!resp?.ok || !resp.items) {
      setMsg(`按段填写失败：${resp?.error ?? '无响应'}`, true);
      return;
    }
    const lines: string[] = [];
    for (const it of resp.items) {
      lines.push(
        `· ${it.zh}：已填 ${it.filled} 段${it.added ? `（新增 ${it.added} 行）` : ''}${it.remaining > 0 ? `；⚠ 还有 ${it.remaining} 段未填——页面行不够且无添加按钮，为避免错填已停止` : ''}`,
      );
      for (const w of it.warnings.slice(0, 3)) lines.push(`  ! ${w}`);
    }
    if (resp.items.length === 0) lines.push('未找到可填写的经历组合。');
    setMsg(lines.join('\n'));
    await refreshFill();
  } catch (e) {
    setMsg(`按段填写出错：${e instanceof Error ? e.message : String(e)}`, true);
  }
}

// ---------- 信息副本管理 ----------

function renderCopies(copies: ProfileCopy[]): void {
  const box = $<HTMLDivElement>('copy-list');
  box.textContent = '';
  $<HTMLSpanElement>('manage-status').textContent = `${copies.length} 份副本 · 默认副本用于页面填写`;
  const countOf = (c: ProfileCopy): number => c.entries.length + (c.custom ?? []).length;
  for (const c of copies) {
    const item = document.createElement('div');
    item.className = 'copy-item';
    const head = document.createElement('div');
    head.className = 'row-head';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.classList.add(c.isDefault ? 'ok' : 'low');
    const name = document.createElement('span');
    name.className = 'fname';
    name.textContent = c.name;
    const tag = document.createElement('span');
    tag.className = `tag ${c.isDefault ? 'has' : 'low'}`;
    tag.textContent = c.isDefault ? '默认' : `${countOf(c)} 项`;
    if (c.isDefault) {
      const cnt = document.createElement('span');
      cnt.className = 'pagetext';
      cnt.textContent = `${countOf(c)} 项`;
      head.appendChild(dot);
      head.appendChild(name);
      head.appendChild(cnt);
      head.appendChild(tag);
    } else {
      head.appendChild(dot);
      head.appendChild(name);
      head.appendChild(tag);
    }
    item.appendChild(head);
    const acts = document.createElement('div');
    acts.className = 'copy-actions';
    if (!c.isDefault) {
      const b1 = document.createElement('button');
      b1.className = 'mini';
      b1.textContent = '设为默认';
      b1.addEventListener('click', async () => {
        await setDefaultCopy(c.id);
        await refreshManage();
        await refreshFill();
      });
      acts.appendChild(b1);
    }
    const b2 = document.createElement('button');
    b2.className = 'mini';
    b2.textContent = '重命名';
    b2.addEventListener('click', async () => {
      const nm = prompt('副本名称', c.name);
      if (nm && nm.trim()) {
        await renameCopy(c.id, nm);
        await refreshManage();
        await refreshFill();
      }
    });
    acts.appendChild(b2);
    const b3 = document.createElement('button');
    b3.className = 'mini';
    b3.textContent = '删除';
    b3.addEventListener('click', async () => {
      if (copies.length <= 1) {
        alert('至少保留一份副本');
        return;
      }
      if (!confirm(`删除副本「${c.name}」？其 ${c.entries.length + (c.custom ?? []).length} 条信息将被移除（不影响其它副本）。`)) return;
      await deleteCopy(c.id);
      await refreshManage();
      await refreshFill();
    });
    acts.appendChild(b3);
    item.appendChild(acts);
    box.appendChild(item);
  }
}

async function refreshManage(): Promise<void> {
  const copies = await listCopies();
  renderCopies(copies);
}

// ---------- 事件绑定与启动 ----------

function switchView(view: 'fill' | 'manage'): void {
  document.querySelectorAll<HTMLElement>('#view-fill, #view-manage').forEach((el) => {
    el.hidden = el.id !== `view-${view}`;
  });
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
}

async function main(): Promise<void> {
  activeTabId = await getActiveTabId();

  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      switchView(b.dataset.view === 'manage' ? 'manage' : 'fill');
      if (b.dataset.view === 'manage') void refreshManage();
      else void refreshFill();
    });
  });

  $<HTMLButtonElement>('btn-open-options').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
  $<HTMLButtonElement>('btn-copy-options').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
  $<HTMLButtonElement>('btn-rescan').addEventListener('click', () => {
    void refreshFill();
  });
  $<HTMLButtonElement>('btn-fill').addEventListener('click', () => {
    void doFill();
  });
  $<HTMLButtonElement>('btn-fill-rows').addEventListener('click', () => {
    void doFillRows();
  });
  $<HTMLButtonElement>('btn-teach').addEventListener('click', async () => {
    if (activeTabId === null) {
      setMsg('无法获取当前标签页', true);
      return;
    }
    if (teachFields.length === 0) {
      setMsg('当前没有可教学的未识别字段', true);
      return;
    }
    try {
      await sendToTab(activeTabId, { type: 'TEACH_OPEN', fields: teachFields });
      setMsg('已在页面上打开教学浮层：逐项选择“这个字段是什么”（教一次全局记住）。\n完成后关闭浮层，再点图标即可看到自动识别。');
    } catch (e) {
      setMsg(`教学浮层打开失败：${e instanceof Error ? e.message : String(e)}`, true);
    }
  });
  $<HTMLButtonElement>('btn-new-copy').addEventListener('click', async () => {
    const name = prompt('新副本名称（如：校招A / 社招B）', '新副本');
    if (!name) return;
    const fromDefault = confirm('要复制当前默认副本的内容作为起点吗？\n（取消=创建空副本）');
    const def = await getDefaultCopy();
    await createCopy(name, fromDefault && def ? def.id : undefined);
    await refreshManage();
    await refreshFill();
  });

  await refreshFill();
}

void main().catch((e) => {
  setMsg(`弹窗初始化失败：${e instanceof Error ? e.message : String(e)}`, true);
});
