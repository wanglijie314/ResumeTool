/**
 * 简历文件读取：.txt/.md 直接读文本；.docx 用 fflate 解压取 document.xml 转文本；
 * .pdf 用 pdfjs（Worker 脚本由构建时静态拷贝到 assets/pdf.worker.mjs）。
 * 全部在本地完成，不上传。
 */
import { strFromU8, unzipSync } from 'fflate';

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

/** 从 .docx 提取纯文本（word/document.xml） */
export function extractDocxText(buf: ArrayBuffer): string {
  const zip = unzipSync(new Uint8Array(buf));
  const xmlEntry = zip['word/document.xml'];
  if (!xmlEntry) throw new Error('该 .docx 缺少 document.xml，无法解析');
  let xml = strFromU8(xmlEntry);
  xml = xml
    .replace(/<w:tab\s*\/>/gi, '\t')
    .replace(/<w:br\s*\/>/gi, '\n')
    .replace(/<\/w:tc>/gi, '\t') // 表格单元格之间用制表符分隔
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<w:t[^>]*>/gi, '')
    .replace(/<\/w:t>/gi, '')
    .replace(/<[^>]+>/g, '');
  const text = decodeXmlEntities(xml)
    .replace(/\t/g, ' | ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return text;
}

let pdfWorkerReady = false;

/** 从 .pdf 提取文本（pdfjs，纯本地） */
export async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfWorkerReady) {
    // worker 文件由构建脚本复制到 dist/assets/pdf.worker.mjs
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('assets/pdf.worker.mjs');
    pdfWorkerReady = true;
  }
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let line = '';
      const buf2: string[] = [];
      for (const item of tc.items) {
        const it = item as { str?: string; hasEOL?: boolean };
        if (typeof it.str !== 'string') continue;
        line += it.str;
        if (it.hasEOL) {
          if (line.trim()) buf2.push(line.trim());
          line = '';
        }
      }
      if (line.trim()) buf2.push(line.trim());
      pages.push(buf2.join('\n'));
    }
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
  return pages.join('\n');
}

/** 按扩展名/类型读取为文本，抛错说明原因 */
export async function resumeFileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
    return await file.text();
  }
  if (name.endsWith('.docx')) {
    return extractDocxText(await file.arrayBuffer());
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return await extractPdfText(await file.arrayBuffer());
  }
  throw new Error('暂只支持 .pdf / .docx / .txt / .md');
}
