/**
 * AI 模型通道（智谱 HTTP API /chat/completions）：
 * 只负责“发送/解析”，技能内容（提示词/契约）由 src/skills 提供。
 * 每次真实发起的模型请求都会写入本地运行日志（source=ai，会话标题=用途），
 * 供在选项页「运行日志」确认是否真的走了 AI 调用（含模型/端点/耗时/错误码）。
 */
import type { Settings } from './storage';
import { appendEvent, endSession, startSession } from './logger';

export interface ChatMessages {
  system: string;
  user: string;
}

export class AiChannelError extends Error {
  code: 'config' | 'network' | 'http' | 'parse';
  constructor(code: AiChannelError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export function hasAiConfig(s: Settings): boolean {
  return !!(s.aiApiKey.trim() && s.aiModel.trim() && s.aiBaseUrl.trim());
}

const lastN = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n)}…` : s;

/**
 * 调用 chat/completions 并返回解析后的 JSON（模型端开启 response_format=json_object）。
 * 兼容智谱等端点：body = { model, messages, temperature, response_format }。
 * purpose 仅用于日志会话标题（如“页面字段识别/简历解析补全”）。
 * logIntoSession：可选，传入已建好的日志会话 id（调用方想把自己的语义事件与本次
 * 请求事件放在同一条会话里时用）；不传则本函数自建并自收尾。
 */
export async function chatJson(
  settings: Settings,
  msgs: ChatMessages,
  timeoutMs = 30000,
  purpose = 'AI 调用',
  logIntoSession?: string,
): Promise<unknown> {
  if (!hasAiConfig(settings)) {
    throw new AiChannelError('config', '请先在「设置」里填写 AI 模型与 API Key');
  }
  const base = settings.aiBaseUrl.trim().replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const model = settings.aiModel.trim();

  // —— 本地运行日志：每次模型请求 = 一个会话（记录失败不影响调用本身）——
  let sessionId = logIntoSession;
  const ownsSession = !sessionId;
  const started = Date.now();
  const log = async (level: 'info' | 'error', msg: string, data?: unknown): Promise<void> => {
    if (!sessionId) return;
    try {
      await appendEvent(sessionId, level, msg, data);
    } catch {
      /* 日志写失败不影响请求 */
    }
  };
  const endLog = async (): Promise<void> => {
    if (!sessionId || !ownsSession) return;
    try {
      await endSession(sessionId);
    } catch {
      /* ignore */
    }
  };
  if (ownsSession) {
    try {
      sessionId = await startSession({
        source: 'ai',
        title: `AI 调用：${purpose}`,
      });
    } catch {
      sessionId = undefined;
    }
  }
  await log('info', `AI 请求发起：${model}（用途：${purpose}）`, {
    url,
    model,
    promptChars: msgs.system.length + msgs.user.length,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.aiApiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: msgs.system },
          { role: 'user', content: msgs.user },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    const code = 'network';
    const detail = aborted ? '请求超时' : `网络错误：${e instanceof Error ? e.message : String(e)}`;
    await log('error', `AI 请求失败：${code}`, {
      code,
      ms: Date.now() - started,
      detail: lastN(detail, 200),
    });
    await endLog();
    throw new AiChannelError(code, detail);
  } finally {
    clearTimeout(timer);
  }
  const ms = Date.now() - started;
  if (!resp.ok) {
    let detail = '';
    try {
      detail = (await resp.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    await log('error', `AI 请求失败：http`, {
      code: 'http',
      status: resp.status,
      ms,
      detail: lastN(detail, 200),
    });
    await endLog();
    throw new AiChannelError('http', `HTTP ${resp.status} ${resp.statusText} ${detail}`);
  }
  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = (await resp.json()) as typeof data;
  } catch (e) {
    await log('error', 'AI 请求失败：parse', {
      code: 'parse',
      ms: Date.now() - started,
      detail: lastN(`响应不是 JSON：${e instanceof Error ? e.message : String(e)}`, 200),
    });
    await endLog();
    throw new AiChannelError('parse', `响应不是 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    await log('error', 'AI 请求失败：parse', {
      code: 'parse',
      ms: Date.now() - started,
      detail: '模型未返回内容',
    });
    await endLog();
    throw new AiChannelError('parse', '模型未返回内容');
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    await log('info', `AI 请求成功（HTTP ${resp.status}，耗时 ${Date.now() - started}ms）`, {
      status: resp.status,
      ms: Date.now() - started,
      respChars: content.length,
    });
    await endLog();
    return parsed;
  } catch (e) {
    await log('error', 'AI 请求失败：parse', {
      code: 'parse',
      ms: Date.now() - started,
      detail: lastN(`模型输出不是合法 JSON：${e instanceof Error ? e.message : String(e)}`, 200),
    });
    await endLog();
    throw new AiChannelError('parse', `模型输出不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
}
