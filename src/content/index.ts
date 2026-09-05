/**
 * 内容脚本主入口：
 * 扫描页面表单 → 分类 → 渲染识别面板；MutationObserver 跟随 SPA 动态渲染；
 * 响应工具栏图标（FORCE_SCAN / 自动补注入）与诊断查询（PING / PROBE / TOAST）。
 * 运行全程写入本地日志（shared/logger），便于排查"是否正确启动 / 是否正确扫描"。
 */
import { RecogPanel } from './panel';
import { collectCandidates, ElementRegistry } from './scanner';
import { classify, domainOf } from './classifier';
import { fillControl } from './filler';
import { openTeachOverlay, teachKindText } from './teachOverlay';
import type { TeachItem } from './teachOverlay';
import { blockToRowValues, detectRowGroups, rowGroupZh } from './rowFill';
import { CONF } from './dictionary';
import { loadUserWords } from '../shared/storage';
import { addIgnore, listIgnores, mappingKeyOf, upsertWord } from '../shared/learning';
import { listCopies, getDefaultCopy, upsertCustom } from '../shared/profile';
import { appendEvent, startSession } from '../shared/logger';
import { customKeyOfName, customNameOfKey, isCustomKey } from '../shared/keys';
import { suggestFieldName } from '../shared/nameHint';
import { fieldZh } from '../shared/taxonomy';
import type { FieldKey } from '../shared/taxonomy';
import type {
  ClassifiedField,
  ControlKind,
  ExperienceBlock,
  FillFieldReport,
  FillReport,
  FillTarget,
  LogEvent,
  SnapshotData,
  SnapshotField,
} from '../shared/types';

const HOST_ID = '__jianli_autofill_host__';
const BOOT_ATTR = 'data-jianli-autofill-booted';

// 模块级加载标记：chunk 只要被执行就会打印。用于区分
// "动态 import 失败（看不到此行）" 与 "已加载但 boot 报错（看得到此行、无后续日志）"。
if (typeof console !== 'undefined') {
  console.info('[简历一键填] 内容脚本 bundle 已加载', location?.href ?? '');
}

interface ScanStats {
  scannedAt: number;
  /** 扫描到的全部控件数（含忽略项） */
  controls: number;
  recognized: number;
  unknown: number;
  ignored: number;
  keys: string[];
}

const notIgnored = (f: ClassifiedField): boolean => !f.result.reasons.includes('#ignore#');

function boot(): void {
  // 只在顶层页面运行
  if (window.top !== window) return;
  if (document.documentElement.hasAttribute(BOOT_ATTR)) return;
  document.documentElement.setAttribute(BOOT_ATTR, '1');

  let sessionId = '';
  void startSession({
    source: 'content',
    url: location.href,
    title: document.title,
  })
    .then((id) => {
      sessionId = id;
      return appendEvent(id, 'info', '内容脚本启动', {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
      });
    })
    .catch(() => {
      /* 扩展上下文被作废（如扩展重载）等场景静默处理 */
    });

  const host = document.createElement('div');
  host.id = HOST_ID;
  (document.body ?? document.documentElement).appendChild(host);

  const registry = new ElementRegistry();
  const follow = { on: true };
  let hiddenByUser = false;
  let scanTimer: number | undefined;
  let lastSig = '';
  let lastDump: ClassifiedField[] = [];
  let lastStats: ScanStats | null = null;
  let teachSession: { close: () => void } | null = null;

  const panel = new RecogPanel(host, {
    onRescan: () => {
      void log('info', '用户点击面板「重扫」');
      scheduleScan(0, 'manual');
    },
    onToggleFollow: (on) => {
      follow.on = on;
      void log('info', `自动跟随页面变化: ${on ? '开' : '关'}`);
    },
    onInspect: (id) => inspectField(id),
    onMinimize: () => {
      hiddenByUser = true;
      void log('info', '面板被收起');
    },
    onExpand: () => {
      hiddenByUser = false;
      void log('info', '面板被展开');
      scheduleScan(0, 'expand');
    },
    onCloseFull: () => {
      hiddenByUser = true;
      follow.on = false;
      void log('info', '识别面板被彻底关闭（本页不再自动弹出）');
    },
  });

  // 记录到当前会话的便捷封装（会话尚未建好时静默丢弃，不阻塞主流程）
  function log(level: LogEvent['level'], msg: string, data?: unknown): void {
    if (sessionId) void appendEvent(sessionId, level, msg, data).catch(() => undefined);
    else console.info(`[简历一键填][pre-session] ${msg}`, data ?? '');
  }

  // 全局错误捕获：任何运行期异常都进日志
  window.addEventListener('error', (e) => {
    void log('error', '页面全局错误', {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    void log('error', '未处理的 Promise 拒绝', {
      reason: e.reason instanceof Error ? e.reason.stack ?? e.reason.message : String(e.reason),
    });
  });

  // —— 尽早注册消息监听：即使后续初始化某处抛错，PING/快照/填写通道依然可用 ——
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'GET_SNAPSHOT') {
      void classifyPage()
        .then((fields) => {
          const snapshot = toSnapshotData(fields);
          void log('debug', '提供页面快照', {
            controls: snapshot.controls,
            recognized: snapshot.recognized,
            unknown: snapshot.unknown,
          });
          sendResponse({ ok: true, snapshot });
        })
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg?.type === 'FILL') {
      const targets = Array.isArray(msg.targets) ? (msg.targets as FillTarget[]) : [];
      void classifyPage()
        .then(async (fields) => {
          // 行组合内的单元格由“按段填经历”驱动，避免普通填写把同值写进每行
          const groups = detectRowGroups(fields, elByIdOf(fields));
          const skipIds = new Set<string>(
            groups.flatMap((g) => g.rows.flat().map((c) => c.id)),
          );
          const report = await buildFillReport(fields, targets, skipIds);
          void log('info', '收到填写指令并完成', {
            targets: report.targets,
            matched: report.totalMatched,
            filled: report.totalFilled,
            fields: report.fields.map((f) => `${f.zh}:${f.filled}/${f.matched}`),
          });
          sendResponse({ ok: true, report });
        })
        .catch((e) => {
          void log('error', '填写失败', String(e));
          sendResponse({ ok: false, error: String(e) });
        });
      return true;
    }
    if (msg?.type === 'GET_ROW_PLAN') {
      void classifyPage()
        .then((fields) => {
          const groups = detectRowGroups(fields, elByIdOf(fields));
          const plans = groups
            .filter((g) => g.kind)
            .map((g) => ({
              kind: g.kind,
              zh: rowGroupZh(g.kind as FieldKey),
              rows: g.rows.length,
              add: !!g.addBtn,
              roles: g.roles,
            }));
          sendResponse({ ok: true, plans });
        })
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg?.type === 'FILL_ROWS') {
      const kindsRaw = Array.isArray(msg.kinds) ? (msg.kinds as string[]) : [];
      void (async () => {
        try {
          const def = await getDefaultCopy().catch(() => undefined);
          const blocksByKind = new Map<string, ExperienceBlock[]>();
          for (const b of def?.blocks ?? []) {
            const arr = blocksByKind.get(b.kind) ?? [];
            arr.push(b);
            blocksByKind.set(b.kind, arr);
          }
          const kinds = kindsRaw.length
            ? kindsRaw.filter((k) => (blocksByKind.get(k)?.length ?? 0) > 0)
            : [...blocksByKind.keys()];
          const items: {
            kind: FieldKey;
            zh: string;
            filled: number;
            remaining: number;
            added: number;
            warnings: string[];
          }[] = [];
          for (const k of kinds) {
            const blocks = blocksByKind.get(k) ?? [];
            if (!blocks.length) continue;
            const r = await fillKindRows(k as FieldKey, blocks);
            items.push({
              kind: k as FieldKey,
              zh: rowGroupZh(k as FieldKey),
              filled: r.filled,
              remaining: r.remaining,
              added: r.added,
              warnings: r.warnings,
            });
          }
          sendResponse({ ok: true, items });
        } catch (e) {
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      })();
      return true;
    }
    if (msg?.type === 'TEACH_OPEN') {
      void (async () => {
        const raw = Array.isArray(msg.fields) ? (msg.fields as SnapshotField[]) : [];
        const seen = new Set<string>();
        const items: TeachItem[] = [];
        for (const f of raw) {
          if (f.fieldKey || f.ignored) continue;
          const labelKey = mappingKeyOf({
            labelText: f.labelText,
            placeholder: f.placeholder,
            name: f.name,
          });
          if (!labelKey || seen.has(labelKey)) continue;
          seen.add(labelKey);
          const hasLabel = !!(f.labelText && f.labelText.trim());
          items.push({
            labelKey,
            display: f.labelText || f.placeholder || f.name || f.idAttr || '(无名控件)',
            kindText: teachKindText(f.kind, f.widget),
            placeholderOnly: !hasLabel,
            suggest: hasLabel ? suggestFieldName(f.labelText) : null,
          });
        }
        // 收集用户已建的自定义字段名，供教学下拉选择
        let customNames: string[] = [];
        try {
          const copies = await listCopies();
          customNames = [
            ...new Set(copies.flatMap((c) => (c.custom ?? []).map((x) => x.name))),
          ];
        } catch {
          /* 读取失败则只展示内置字段 */
        }
        teachSession?.close();
        teachSession = items.length
          ? openTeachOverlay(
              items,
              {
                onAddCustom: async (item, name, value) => {
                  const nm = name.trim();
                  if (!nm) {
                    showToast('自定义字段名不能为空');
                    return;
                  }
                  const key = customKeyOfName(nm);
                  await upsertWord(item.display, key, 'taught');
                  if (value.trim()) {
                    const def = await getDefaultCopy().catch(() => undefined);
                    if (def) await upsertCustom(def.id, nm, value);
                  }
                  showToast(
                    `已新增自定义字段「${nm}」并记住「${item.display}」（全局）${value.trim() ? `，值已存到默认副本` : ''}`,
                  );
                  void log('info', '教学：新增自定义字段', { text: item.display, name: nm, value });
                },
                onTeach: async (item, fieldKey) => {
                  await upsertWord(item.display, fieldKey, 'taught');
                  showToast(`已记住：「${item.display}」= ${fieldLabel(fieldKey)}（全局生效）`);
                  void log('info', '教学：字段归类', { text: item.display, fieldKey });
                },
                onIgnore: async (item) => {
                  await addIgnore(item.labelKey, domainOf(location.hostname));
                  showToast('已忽略本站该字段，其它网站不受影响');
                  void log('info', '教学：本站忽略', { text: item.display });
                },
                onClose: () => {
                  teachSession = null;
                  void log('info', '教学浮层已关闭');
                },
              },
              customNames,
            )
          : null;
        sendResponse({ ok: true, count: items.length });
      })().catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg?.type === 'TEACH_CLOSE') {
      teachSession?.close();
      teachSession = null;
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'PROBE') {
      const p = probe();
      void log('debug', '收到 PROBE 查询');
      sendResponse({ ok: true, probe: p });
      return false;
    }
    if (msg?.type === 'TOAST') {
      showToast(String(msg.text ?? ''));
      return false;
    }
    if (msg?.type === 'FORCE_SCAN') {
      hiddenByUser = false;
      void scan(true)
        .then(() => {
          const s = lastStats;
          showToast(summaryLine());
          sendResponse({ ok: true, ...(s ?? {}) });
        })
        .catch((e) => {
          void log('error', '强制扫描失败', String(e));
          sendResponse({ ok: false, error: String(e) });
        });
      return true;
    }
    return false;
  });

  function showToast(text: string): void {
    document.getElementById('jl-toast')?.remove();
    const t = document.createElement('div');
    t.id = 'jl-toast';
    t.textContent = `简历一键填：${text}`;
    Object.assign(t.style, {
      position: 'fixed',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483001',
      background: '#1d4ed8',
      color: '#fff',
      padding: '8px 14px',
      borderRadius: '999px',
      fontSize: '13px',
      boxShadow: '0 4px 16px rgba(0,0,0,.25)',
      maxWidth: '80vw',
      fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
    });
    document.documentElement.appendChild(t);
    window.setTimeout(() => t.remove(), 3200);
  }

  /** 收集 + 分类当前页面全部可见控件（每轮扫描/快照/填写复用同一套逻辑） */
  async function classifyPage(): Promise<ClassifiedField[]> {
    const { candidates } = collectCandidates(document, registry);
    const [learned, ignores] = await Promise.all([loadUserWords(), listIgnores()]);
    const dom = domainOf(location.hostname);
    const ignoredKeys = new Set(ignores.filter((i) => i.domain === dom).map((i) => i.labelKey));
    const ctx = { learned, ignoredKeys };
    return candidates.map((c) => ({ candidate: c, result: classify(c, ctx) }));
  }

  function elByIdOf(fields: ClassifiedField[]): Map<string, HTMLElement> {
    const m = new Map<string, HTMLElement>();
    for (const f of fields) {
      const el = registry.get(f.candidate.id);
      if (el instanceof HTMLElement) m.set(f.candidate.id, el);
    }
    return m;
  }

  const sleepLocal = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  /** 当前页面某一经历组合的最新行模板（整页重探测） */
  async function rowGroupOfKind(kind: FieldKey): Promise<ReturnType<typeof detectRowGroups>[number] | null> {
    const fields = await classifyPage();
    const groups = detectRowGroups(fields, elByIdOf(fields));
    return groups.find((g) => g.kind === kind) ?? null;
  }

  /**
   * 按默认副本的 blocks 顺序填写某个经历组合：
   * 不足一行时点“添加”增行继续；没有更多行也没有添加按钮 → 记录剩余并停（不串填）。
   */
  async function fillKindRows(
    kind: FieldKey,
    blocks: ExperienceBlock[],
  ): Promise<{ filled: number; remaining: number; added: number; warnings: string[] }> {
    const warnings: string[] = [];
    let idx = 0;
    let added = 0;
    for (let bi = 0; bi < blocks.length; bi++) {
      const group = await rowGroupOfKind(kind);
      if (!group) {
        if (idx === 0) warnings.push(`页面未识别到“${rowGroupZh(kind)}”组合`);
        break;
      }
      if (idx >= group.rows.length) {
        if (group.addBtn) {
          group.addBtn.click();
          added++;
          await sleepLocal(450);
          continue; // 同一段重新寻找可用行（bi 不自增）
        }
        break; // 无更多行且无添加按钮 → 剩余段不再填
      }
      const cells = group.rows[idx]!;
      const values = blockToRowValues(blocks[bi]!);
      for (const cell of cells) {
        const v = values.get(cell.role);
        if (!v) continue;
        const att = await fillControl(cell.el, v, {
          kind: cell.kind as ControlKind,
          widget: cell.widget,
        });
        if (!att.filled && att.notice && !warnings.includes(att.notice)) warnings.push(att.notice);
      }
      idx++;
    }
    return { filled: idx, remaining: blocks.length - idx, added, warnings };
  }

  async function scan(forceShow = false): Promise<void> {
    const fields = await classifyPage();
    lastDump = fields;

    const visible = fields.filter(notIgnored);
    const recognized = visible.filter((f) => f.result.fieldKey);
    const stats: ScanStats = {
      scannedAt: Date.now(),
      controls: fields.length,
      recognized: recognized.length,
      unknown: visible.length - recognized.length,
      ignored: fields.length - visible.length,
      keys: recognized.map((f) => f.result.fieldKey as string),
    };
    lastStats = stats;
    setDebugAttrs(stats);

    const sig = signature(fields);
    const changed = sig !== lastSig;
    if (changed) {
      lastSig = sig;
      panel.render(fields);
      const autoShow = !hiddenByUser && stats.recognized >= 2 && visible.length >= 2;
      if (autoShow || forceShow) panel.show();
      void log('info', `扫描完成（内容变化）`, {
        controls: stats.controls,
        recognized: stats.recognized,
        unknown: stats.unknown,
        ignored: stats.ignored,
        keys: stats.keys,
      });
    } else if (forceShow) {
      panel.render(fields);
      panel.show();
      void log('info', '强制扫描（内容未变化）', {
        controls: stats.controls,
        recognized: stats.recognized,
        unknown: stats.unknown,
        ignored: stats.ignored,
      });
    }
  }

  function scheduleScan(delay: number, why: string): void {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      void scan()
        .then(() => {
          if (why !== 'dom') void log('debug', `扫描触发源: ${why}`);
        })
        .catch((e) => {
          void log('error', '扫描失败', { why, error: e instanceof Error ? e.stack ?? e.message : String(e) });
        });
    }, delay);
  }

  function signature(fields: ClassifiedField[]): string {
    return fields
      .map(
        (f) =>
          `${f.candidate.haystack}|${f.candidate.optionTexts.join(',')}|${f.candidate.required}|${f.result.fieldKey}|${f.result.confidence.toFixed(2)}`,
      )
      .join('\n');
  }

  function setDebugAttrs(s: ScanStats): void {
    try {
      const de = document.documentElement;
      de.setAttribute('data-jianli-fields', String(s.controls));
      de.setAttribute('data-jianli-recognized', String(s.recognized));
      de.setAttribute('data-jianli-keys', s.keys.join(','));
    } catch {
      /* ignore */
    }
  }

  function summaryLine(): string {
    if (!lastStats) return '尚未扫描';
    const { controls, recognized, unknown, ignored } = lastStats;
    if (controls === 0) return '未找到表单控件（可能在 iframe 内或尚未渲染）';
    return `已识别 ${recognized}/${controls} · 未识别 ${unknown} · 忽略 ${ignored}`;
  }

  /** 供 popup 使用的可序列化快照 */
  function toSnapshotData(fields: ClassifiedField[]): SnapshotData {
    const out: SnapshotField[] = fields.map((f) => ({
      id: f.candidate.id,
      tag: f.candidate.tag,
      inputType: f.candidate.inputType,
      kind: f.candidate.kind,
      widget: f.candidate.widget,
      labelText: f.candidate.labelText,
      placeholder: f.candidate.placeholder,
      name: f.candidate.name,
      idAttr: f.candidate.idAttr,
      optionTexts: [...f.candidate.optionTexts],
      required: f.candidate.required,
      readonly: f.candidate.readonly,
      disabled: f.candidate.disabled,
      fieldKey: f.result.fieldKey,
      confidence: f.result.confidence,
      ignored: f.result.reasons.includes('#ignore#'),
      reasons: [...f.result.reasons],
    }));
    const visible = fields.filter((f) => !f.result.reasons.includes('#ignore#'));
    const recognized = visible.filter((f) => f.result.fieldKey !== null);
    return {
      fields: out,
      controls: fields.length,
      recognized: recognized.length,
      unknown: visible.length - recognized.length,
      ignored: fields.length - visible.length,
    };
  }

  /** 字段键展示名（自定义字段显示用户名称） */
  function fieldLabel(key: string): string {
    return isCustomKey(key) ? customNameOfKey(key) : fieldZh(key);
  }

  /** 按填充目标写页（按控件形态分策略、逐项串行，避免多个弹出层互相干扰），产出汇总报告 */
  const FILL_MIN_CONF = CONF.medium;
  async function buildFillReport(
    fields: ClassifiedField[],
    targets: FillTarget[],
    skipIds?: ReadonlySet<string>,
  ): Promise<FillReport> {
    const fieldReports = new Map<string, FillFieldReport>();
    let totalMatched = 0;
    let totalFilled = 0;
    for (const t of targets) {
      if (fieldReports.has(t.fieldKey)) continue; // 每个 key 一轮即可
      const fr: FillFieldReport = {
        fieldKey: t.fieldKey,
        zh: fieldLabel(t.fieldKey),
        matched: 0,
        filled: 0,
        notices: [],
      };
      const matches = fields.filter(
        (f) =>
          f.result.fieldKey === t.fieldKey &&
          !f.result.reasons.includes('#ignore#') &&
          f.result.confidence >= FILL_MIN_CONF &&
          !(skipIds && skipIds.has(f.candidate.id)),
      );
      for (const m of matches) {
        fr.matched++;
        const el = registry.get(m.candidate.id);
        if (!(el instanceof HTMLElement)) continue;
        const att = await fillControl(el, t.value, {
          kind: m.candidate.kind,
          widget: m.candidate.widget,
          radioName: m.candidate.name,
        });
        if (att.filled) {
          fr.filled++;
          totalFilled++;
        } else if (att.notice && !fr.notices.includes(att.notice)) {
          fr.notices.push(att.notice);
        }
      }
      totalMatched += fr.matched;
      if (fr.matched === 0) fr.notices.push('本页未找到该字段');
      fieldReports.set(t.fieldKey, fr);
    }
    return {
      targets: targets.length,
      totalMatched,
      totalFilled,
      fields: [...fieldReports.values()],
    };
  }

  function probe(): Record<string, unknown> {
    const tags = { input: 0, textarea: 0, select: 0, contenteditable: 0 };
    document
      .querySelectorAll('input, textarea, select, [contenteditable]')
      .forEach((el) => {
        const tag = el.tagName;
        if (tag === 'INPUT') tags.input++;
        else if (tag === 'TEXTAREA') tags.textarea++;
        else if (tag === 'SELECT') tags.select++;
        else tags.contenteditable++;
      });
    const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => {
      let href = '?';
      try {
        href = f.contentWindow?.location.href ?? '(无窗口)';
      } catch {
        href = '(跨域，无法读取)';
      }
      return {
        src: f.getAttribute('src') ?? '',
        href,
        id: f.id || '',
        cls: f.className || '',
      };
    });
    return {
      url: location.href,
      title: document.title,
      scannedAt: lastStats?.scannedAt ?? null,
      stats: lastStats,
      tags,
      iframes,
    };
  }

  function inspectField(id: string): void {
    const el = registry.get(id);
    if (!(el instanceof HTMLElement)) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const prev = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '2px dashed #f59e0b';
    el.style.outlineOffset = '2px';
    window.setTimeout(() => {
      el.style.outline = prev;
      el.style.outlineOffset = prevOffset;
    }, 1800);
  }

  // 跟随 SPA 动态渲染
  const root = document.body ?? document.documentElement;
  const observer = new MutationObserver(() => {
    if (follow.on) scheduleScan(450, 'dom');
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-hidden'],
  });

  scheduleScan(350, 'boot');
  // SPA 首屏数据常晚于 DOM 出现，稍后再补扫一次
  window.setTimeout(() => scheduleScan(0, 'boot-late'), 2500);
  window.setTimeout(() => {
    void log('info', `启动完成：本次会话将记录后续扫描与错误（面板状态: 已就绪）`);
  }, 3000);

  // 调试入口：控制台 window.__jianliAutofillDebug
  const debug = {
    rescan: () => scheduleScan(0, 'debug'),
    list: () => lastDump,
    raw: () => collectCandidates(document, registry).candidates,
    probe: () => probe(),
    stats: () => lastStats,
  };
  try {
    (window as unknown as Record<string, unknown>).__jianliAutofillDebug = debug;
  } catch {
    /* 忽略 */
  }
}

/**
 * 环境守卫：本 bundle 曾被错误地加载进无 document 的上下文（如 service worker），
 * 顶层执行 document 相关代码会抛 ReferenceError。任何非页面环境一律跳过启动。
 */
const HAS_DOM = typeof document !== 'undefined' && typeof window !== 'undefined';

if (!HAS_DOM) {
  const where =
    typeof location !== 'undefined' && location.href
      ? location.href
      : typeof self !== 'undefined'
        ? 'worker/无文档环境'
        : '未知环境';
  if (typeof console !== 'undefined') {
    console.warn('[简历一键填] 内容脚本被加载到非页面环境，跳过启动。', where);
  }
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
