/**
 * 文本相似度 / 模糊匹配（用于下拉框“最接近的选项”）。
 */
export function textSimilarity(a: string, b: string): number {
  const x = a.trim();
  const y = b.trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) {
    // 包含关系视为高度相近，但差距越大略降
    return 0.9;
  }
  // 公共字符占比（中文同义词场景够用）
  const setA = new Set<string>(x);
  let common = 0;
  for (const ch of y) if (setA.has(ch)) common++;
  const ratio = common / Math.max(x.length, y.length);
  // 长度差异惩罚：对短词对长串要求更高
  const lenPenalty = 1 - Math.abs(x.length - y.length) / Math.max(x.length, y.length, 1) * 0.35;
  return Math.max(0, ratio * lenPenalty);
}

/** 从候选文本里找与 value 最接近的；低于 minScore 返回 null */
export function bestMatchIndex(
  candidates: { text: string }[],
  value: string,
  minScore = 0.6,
): number | null {
  let best = -1;
  let bestScore = 0;
  candidates.forEach((c, i) => {
    const s = textSimilarity(c.text, value);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return bestScore >= minScore && best >= 0 ? best : null;
}
