/**
 * 字段分类器：把扫描出的候选控件归一到 taxonomy 字段键 + 置信度。
 * 优先级：用户词表（教学/别名，全局 100%）> 内置词典 > 输入类型启发 > 未识别。
 */
import { BUILTIN_RULES, COMBINED_FIELD_RX, CONF, IGNORE_RX } from './dictionary';
import { normalizeText, truncate } from '../shared/normalize';
import { mappingKeyOf } from '../shared/learning';
import { fieldDef, fieldZh } from '../shared/taxonomy';
import type { FieldKey } from '../shared/taxonomy';
import type { Classification, FieldCandidate, WordMapping } from '../shared/types';

export interface ClassifyContext {
  /** 全局用户词表（教学 + 别名，跨站点生效） */
  learned: WordMapping[];
  /** 本站忽略的文本键集合（用户在页面里选择"忽略本站"的控件），命中则直接忽略 */
  ignoredKeys?: ReadonlySet<string>;
}

export function domainOf(hostname: string): string {
  return hostname.replace(/^www\./, '').toLowerCase();
}

const OPTION_FALLBACKS: { keys: FieldKey[]; options: string[]; conf: number }[] = [
  // 无标签时按选项集合猜测：男/女 → 性别
  {
    keys: ['gender'],
    options: ['男', '女', '男性', '女性', '男/女'],
    conf: 0.85,
  },
  {
    keys: ['job_type'],
    options: ['全职', '兼职', '实习', '不限', '全职/实习'],
    conf: 0.72,
  },
];

const MALE_FEMALE = new Set(['男', '女', '男性', '女性']);

function none(reasons: string[]): Classification {
  return { fieldKey: null, fieldGroup: null, confidence: 0, basis: 'none', reasons };
}

export function classify(candidate: FieldCandidate, ctx: ClassifyContext): Classification {
  const reasons: string[] = [];
  const haystack = candidate.haystack;

  if (!haystack && candidate.optionTexts.length === 0) {
    return none(['没有任何可识别文本（无标签/占位符/name）']);
  }

  // 1) 直接忽略的控件
  for (const rx of IGNORE_RX) {
    if (rx.test(haystack)) {
      reasons.push('#ignore#');
      reasons.push('验证码/登录/搜索类控件，忽略');
      return none(reasons);
    }
  }

  // 2) 词表匹配键（教学/别名/忽略共用同一套取键规则）
  const key = mappingKeyOf({
    labelText: candidate.labelText,
    placeholder: candidate.placeholder,
    name: candidate.name,
  });

  // 2.1) 本站忽略：在该站曾对同一文本选过"忽略" → 不再提示
  if (key && ctx.ignoredKeys?.has(key)) {
    reasons.push('#ignore#');
    reasons.push('本站忽略（曾在教学里对该文本选择忽略）');
    return none(reasons);
  }

  // 2.2) 用户词表（教学/别名，全局生效，最高优先级）
  if (key) {
    const hit = ctx.learned.find((w) => w.labelKey === key);
    if (hit) {
      const src = hit.source === 'taught' ? '教学' : '别名';
      return {
        fieldKey: hit.fieldKey,
        fieldGroup: fieldDef(hit.fieldKey)?.group ?? null,
        confidence: 1,
        basis: 'learned-rule',
        reasons: [`命中用户词表（${src}）：该文本 = ${fieldZh(hit.fieldKey)}`],
      };
    }
  }

  // 3) 合并型字段（如"四六级成绩"一个输入框）特殊说明
  if (COMBINED_FIELD_RX.some((rx) => rx.test(haystack))) {
    return none(['合并型字段（如“四六级成绩”合在一起），需要拆分为单字段后再处理']);
  }

  // 4) 内置词典：取最高分
  let bestKey: FieldKey | null = null;
  let bestScore = -1;
  let bestPattern: RegExp | null = null;
  for (const rule of BUILTIN_RULES) {
    for (const rx of rule.rx) {
      if (rx.test(haystack) && rule.weight > bestScore) {
        bestScore = rule.weight;
        bestKey = rule.key;
        bestPattern = rx;
      }
    }
  }

  // 5) 单选组选项集合启发（仅当没有标签文本时兜底）
  if (bestKey === null && candidate.optionTexts.length > 0) {
    const opts = candidate.optionTexts.map((o) => normalizeText(o)).filter(Boolean);
    for (const fb of OPTION_FALLBACKS) {
      const k = fb.keys[0];
      if (!k) continue;
      const hitAll = fb.options.every((o) => opts.includes(o));
      const maleFemale = k === 'gender' && opts.some((o) => MALE_FEMALE.has(o));
      if (hitAll || (k === 'gender' && maleFemale && opts.length <= 3)) {
        bestKey = k;
        bestScore = fb.conf;
        reasons.push(`选项集合识别：${opts.join('/')}`);
        break;
      }
    }
  }

  if (bestKey === null) {
    return none([`词典未命中（文本线索：${truncate(haystack, 28)}）`]);
  }

  // 6) 附加线索修正置信度
  let confidence = bestScore;
  const addon: string[] = [];
  // 仅靠占位符/属性线索（页面没有真正的标签文本）时压低置信度
  const hasRealLabel = candidate.labelSources.some(
    (s) => s.how !== 'placeholder' && s.how !== 'attr',
  );
  if (!hasRealLabel) {
    confidence = Math.min(confidence, CONF.medium + 0.05);
    addon.push('无页面标签，仅占位符/属性线索');
  }
  confidence = Math.max(0, Math.min(1, confidence));

  reasons.push(
    `词典规则「${fieldZh(bestKey)}」权重 ${bestScore.toFixed(2)}${bestPattern ? ` / 命中 ${bestPattern}` : ''}`,
    ...addon,
  );
  return {
    fieldKey: bestKey,
    fieldGroup: fieldDef(bestKey)?.group ?? null,
    confidence,
    basis: 'dictionary',
    reasons,
  };
}
