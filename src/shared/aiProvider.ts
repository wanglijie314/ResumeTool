/**
 * AI 模型通道（智谱 HTTP API /chat/completions）：
 * 只负责“发送/解析”，技能内容（提示词/契约）由 src/skills 提供。
 */
import type { Settings } from './storage';

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

/**
 * 调用 chat/completions 并返回解析后的 JSON（模型端开启 response_format=json_object）。
 * 兼容智谱等端点：body = { model, messages, temperature, response_format }。
 */
export async function chatJson(
  settings: Settings,
  msgs: ChatMessages,
  timeoutMs = 30000,
): Promise<unknown> {
  if (!hasAiConfig(settings)) {
    throw new AiChannelError('config', '请先在「设置」里填写 AI 模型与 API Key');
  }
  const base = settings.aiBaseUrl.trim().replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
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
        model: settings.aiModel.trim(),
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
    throw new AiChannelError('network', aborted ? '请求超时' : `网络错误：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    let detail = '';
    try {
      detail = (await resp.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new AiChannelError('http', `HTTP ${resp.status} ${resp.statusText} ${detail}`);
  }
  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = (await resp.json()) as typeof data;
  } catch (e) {
    throw new AiChannelError('parse', `响应不是 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new AiChannelError('parse', '模型未返回内容');
  try {
    return JSON.parse(content) as unknown;
  } catch (e) {
    throw new AiChannelError('parse', `模型输出不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
}
