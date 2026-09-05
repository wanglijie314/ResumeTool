/**
 * 简历文本 → 结构化解析（纯函数，可单测）。
 * 两级输出：
 *  1) entries：标量字段 + 各经历"整段"粗字段（兼容直接填写整段经历类的页面控件）；
 *  2) blocks ：把 实习/工作/项目/教育/校园/获奖 区块切成"实例"，每个实例抽子字段
 *     （公司/职位/部门/时间/学校/专业/学历/名称/描述…），多段各自成块。
 */
import type { FieldKey } from './taxonomy';
import type { ExperienceBlock, ExperienceBlockField, ExperienceRole } from './types';

export interface ParsedEntry {
  fieldKey: FieldKey;
  value: string;
  multi?: boolean;
}

export interface ParseResult {
  entries: ParsedEntry[];
  blocks: ExperienceBlock[];
  /** 未能归类的行（抽样，最多 10 行） */
  unmatched: string[];
}

/** 子字段角色的通用中文名（兜底） */
export const EXPERIENCE_ROLE_ZH: Record<ExperienceRole, string> = {
  name: '名称',
  company: '公司/单位',
  role: '职位/岗位',
  department: '部门',
  responsibility: '职责',
  period: '时间段',
  school: '学校/院校',
  major: '专业',
  degree: '学历/学位',
  description: '描述/内容',
  other: '其它',
};

/** 各经历大类的固定子字段显示名（用户口径） */
const KIND_ROLE_LABEL: Partial<Record<FieldKey, Partial<Record<ExperienceRole, string>>>> = {
  internship_experience: {
    company: '实习公司',
    role: '实习岗位',
    period: '实习时间段',
    description: '实习内容/经历描述',
    name: '实习主题',
  },
  work_experience: {
    company: '公司/单位',
    role: '职位/岗位',
    department: '部门',
    period: '在职时间段',
    description: '工作内容/经历描述',
  },
  project_experience: {
    name: '项目名称',
    responsibility: '项目职责',
    description: '项目描述',
    period: '项目时间',
    role: '项目角色',
  },
  edu_experience: {
    school: '学校/院校',
    degree: '学历/学位',
    major: '专业',
    period: '在校时间段',
    description: '在校说明',
  },
};

export function experienceRoleLabel(kind: FieldKey, role: ExperienceRole): string {
  return KIND_ROLE_LABEL[kind]?.[role] ?? EXPERIENCE_ROLE_ZH[role];
}

const clean = (s: string): string =>
  s
    .replace(/^[\s\-•·*▪◦—–·]+/, '')
    .replace(/[\s，。；;、,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

const stripBullet = (s: string): string => s.replace(/^\s*[-•·*▪◦—]\s*/, '').trim();

/** 区块标题 → 字段键（标题自己占一行，且较短） */
const SECTION_RULES: { key: FieldKey; re: RegExp }[] = [
  { key: 'edu_experience', re: /^(教育经历|教育背景|教育|教育及培训经历|教育培训经历)/i },
  { key: 'internship_experience', re: /^(实习经历|实习经验)/i },
  { key: 'work_experience', re: /^(工作经历|工作经验|工作履历|职业经历)/i },
  { key: 'project_experience', re: /^(项目经历|项目经验|项目实践)/i },
  { key: 'campus_experience', re: /^(校园经历|学生工作|学生干部经历|社团经历|校园实践|社会活动经历)/i },
  { key: 'awards', re: /^(获奖经历|获奖情况|所获荣誉|荣誉奖项|奖项荣誉|荣誉)/i },
  { key: 'skills', re: /^(专业技能|技能特长|技能证书|职业技能|资格证书|个人技能)/i },
  { key: 'self_eval', re: /^(自我评价|个人评价|自我介绍|个人简介|个人总结)/i },
];

/** 标量行的抽取规则：行首为标签 + 冒号。逐行按顺序匹配，命中即消费该行 */
const SCALAR_RULES: { key: FieldKey; re: RegExp; pick?: (m: RegExpMatchArray, line: string) => string | null }[] = [
  {
    key: 'name',
    re: /^(?:姓名|名字|真实姓名|Name)\s*[:：]\s*(.+)/i,
    pick: (m) => clean(m[1]!).slice(0, 40) || null,
  },
  {
    key: 'gender',
    re: /^(?:性别|Gender)\s*[:：]\s*(男|女|保密|未知)/i,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'birth_date',
    re: /^(?:出生日期|出生年月|出生时间|生日|Date of Birth|Birth)\s*[:：]\s*(.+)/i,
    pick: (m) => clean(m[1]!).slice(0, 24) || null,
  },
  {
    key: 'native_place',
    re: /^(?:籍贯|户口所在地|生源地)\s*[:：]\s*(.+)/,
    pick: (m) => clean(m[1]!).slice(0, 24) || null,
  },
  {
    key: 'ethnicity',
    re: /^(?:民族|Ethnicity)\s*[:：]\s*(.+)/i,
    pick: (m) => clean(m[1]!).slice(0, 12) || null,
  },
  {
    key: 'political_status',
    re: /^(?:政治面貌)\s*[:：]\s*(.+)/,
    pick: (m) => clean(m[1]!).slice(0, 12) || null,
  },
  {
    key: 'marital_status',
    re: /^(?:婚姻状况|婚否)\s*[:：]\s*(.+)/,
    pick: (m) => clean(m[1]!).slice(0, 8) || null,
  },
  {
    key: 'mobile',
    re: /^(?:手机号码?|联系电话|电话|Mobile|Phone)\s*[:：]?\s*([+\d][\d\-  ]{5,20})/i,
    pick: (m) => {
      const digits = (m[1] ?? '').replace(/\D/g, '');
      return digits.length >= 7 ? digits.slice(-11) : null;
    },
  },
  {
    key: 'email',
    re: /^(?:电子邮箱|邮箱|电子邮件|Email|E-mail)\s*[:：]\s*([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/i,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'wechat',
    re: /^(?:微信号|WeChat|Weixin)\s*[:：]\s*([\w.-]{4,40})/i,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'qq',
    re: /^(?:QQ号|QQ)\s*[:：]\s*([1-9]\d{4,11})/i,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'id_card',
    re: /^(?:身份证号(?:码)?|证件号码?)\s*[:：]\s*([0-9Xx]{15,18})/i,
    pick: (m) => (m[1] ?? '').toUpperCase(),
  },
  {
    key: 'passport_no',
    re: /^(?:护照号(?:码)?|Passport)\s*[:：]\s*([A-Za-z0-9]{5,16})/i,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'school',
    re: /^(?:毕业院校|毕业学校|就读院校|就读学校|学校名称|毕业院校名称|院校)\s*[:：]\s*(.+)/,
    pick: (m) => clean(m[1]!).slice(0, 60) || null,
  },
  {
    key: 'degree',
    re: /^(?:最高学历|学历|学位)\s*[:：]\s*(本科|硕士|博士|学士|研究生|专科|大专|高中|中专|高职|其他)/i,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'major',
    re: /^(?:所学专业|专业名称|主修专业|最高学历专业|专业)\s*[:：]\s*(.+)/,
    pick: (m) => clean(m[1]!).slice(0, 60) || null,
  },
  {
    key: 'graduate_year',
    re: /^(?:毕业时间|毕业年份|毕业年月|预计毕业)\s*[:：]?\s*(20\d{2}[^\s]*)/,
    pick: (m) => clean(m[1]!).slice(0, 20) || null,
  },
  {
    key: 'gpa',
    re: /^(?:绩点|平均学分绩点|GPA)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)/i,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'cet4_score',
    re: /^(?:(?:英语|大学英语)?四级|CET[- ]?4)\s*(?:成绩|分数)?\s*[:：]\s*([0-9]{2,3})/i,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'cet6_score',
    re: /^(?:(?:英语|大学英语)?六级|CET[- ]?6)\s*(?:成绩|分数)?\s*[:：]\s*([0-9]{2,3})/i,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'toefl_score',
    re: /^(?:托福|TOEFL)\s*(?:成绩)?\s*[:：]\s*([0-9]{1,3})/i,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'ielts_score',
    re: /^(?:雅思|IELTS)\s*(?:成绩)?\s*[:：]\s*([0-9]+(?:\.[0-9])?)/i,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'current_company',
    re: /^(?:现任职(?:公司|单位)|目前就职|现单位)\s*[:：]\s*(.+)/,
    pick: (m) => clean(m[1]!).slice(0, 40) || null,
  },
  {
    key: 'expect_city',
    re: /^(?:期望城市|意向城市|期望工作地点)\s*[:：]\s*(.+)/,
    pick: (m) => clean(m[1]!).slice(0, 40) || null,
  },
  {
    key: 'expect_position',
    re: /^(?:期望职位|意向职位|期望岗位|求职意向)\s*[:：]\s*(.+)/,
    pick: (m) => clean(m[1]!).slice(0, 60) || null,
  },
  {
    key: 'expect_salary',
    re: /^(?:期望薪资|期望月薪|期望薪酬|薪资要求)\s*[:：]\s*(.+)/,
    pick: (m) => clean(m[1]!).slice(0, 24) || null,
  },
  {
    key: 'available_date',
    re: /^(?:到岗时间|入职时间)\s*[:：]\s*(.+)/,
    pick: (m) => clean(m[1]!).slice(0, 24) || null,
  },
  {
    key: 'referral_code',
    re: /^(?:内推码|推荐码)\s*[:：]\s*([\w-]{3,30})/,
    pick: (m) => m[1] ?? null,
  },
  {
    key: 'channel',
    re: /^(?:招聘信息来源|信息来源|招聘渠道)\s*[:：]\s*(.+)/,
    pick: (m) => clean(m[1]!).slice(0, 40) || null,
  },
];

const isHeaderLine = (line: string): number => SECTION_RULES.findIndex((r) => r.re.test(line));

// ---------- 结构化经历块（实例切分 + 子字段抽取） ----------

const DATE_TOK = /20\d{2}/;
const endsPunct = (s: string): boolean => /[。；;.．!！?？]$/.test(s);
const descLead = (s: string): boolean =>
  /^(负责|参与|协助|独立|主导|描述|简介|内容|工作内容|主要工作|项目介绍|亮点)/.test(s);
const softStart = (s: string): boolean => /^[，、与及并而和。；;]/.test(s);

const RANGE_RE =
  /((?:20\d{2})\s*[年./-]?\s*\d{1,2}(?:月|[./-]\d{1,2})?)\s*(?:[-~至到—–]{1,2})\s*((?:20\d{2})\s*[年./-]?\s*\d{1,2}(?:月|[./-]\d{1,2})?|至今|现在|present|current)/i;
const SINGLE_DATE_RE = /(20\d{2}\s*[年./-]?\s*\d{1,2}(?:月|[./-]\d{1,2})?)/i;

/** 把日期片段统一成 xxxx.xx(.xx) 点分格式（起止时间的规范输入） */
function normDateBound(raw: string): string {
  const m = raw.match(/^(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*(?:[-/.月]\s*(\d{1,2}))?/);
  if (!m) return clean(raw);
  const pad = (n: string): string => String(Number(n)).padStart(2, '0');
  let out = `${m[1]}.${pad(m[2]!)}`;
  if (m[3]) out += `.${pad(m[3])}`;
  return out;
}

function extractPeriod(text: string): string {
  const joined = text.replace(/[\s·•|]/g, ' ');
  const range = joined.match(RANGE_RE);
  if (range) {
    return `${normDateBound(range[1]!)}-${normDateBound(range[2]!)}`;
  }
  const single = joined.match(SINGLE_DATE_RE);
  return single ? normDateBound(single[1]!) : '';
}

function isBlockKind(kind: FieldKey): boolean {
  return [
    'edu_experience',
    'internship_experience',
    'work_experience',
    'project_experience',
    'campus_experience',
    'awards',
  ].includes(kind);
}

interface Instance {
  heading: string;
  body: string[];
}

/** 区块内按"疑似新经历"切实例 */
function splitInstances(lines: string[]): Instance[] {
  const out: Instance[] = [];
  let cur: string[] = [];
  const flush = (): void => {
    if (cur.length === 0) return;
    const heading = clean(stripBullet(cur[0]!));
    const body = cur.slice(1).map(stripBullet).filter(Boolean);
    out.push({ heading, body });
    cur = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-•·*▪◦—]/.test(line);
    const isFirst = cur.length === 0;
    const dateStart = DATE_TOK.test(line);
    const hasColon = line.slice(0, 32).includes('：');
    const prev = cur[cur.length - 1];
    // 判定“疑似新一段经历”，三条防线避免把同段内容拆散：
    // 1) 含中文冒号（成就小标题“xxx：…”）不切段；
    // 2) 短行切段需上一行以句号结尾，且本行不以软起/描述词开头、本身不以句号结尾；
    // 3) 时间开头的行也要求不带冒号。
    const looksNew =
      !bullet &&
      !isFirst &&
      !hasColon &&
      (dateStart ||
        (line.length <= 44 &&
          !endsPunct(line) &&
          !softStart(line) &&
          !descLead(line) &&
          !!prev &&
          endsPunct(prev)));
    if (looksNew) flush();
    cur.push(line);
  }
  flush();
  return out;
}

const pushField = (
  fields: ExperienceBlockField[],
  role: ExperienceRole,
  value: string,
): void => {
  const v = clean(value);
  if (v) fields.push({ role, value: v });
};

/** 整块剔除“2021.07-2021.10/2020年9月至今”等日期片段 */
const DATE_BLOCK_RE =
  /(?:20\d{2})\s*[年./-]?\s*\d{1,2}(?:月|[./-]\d{1,2})?(?:\s*(?:[-~至到—–]{1,2})\s*(?:(?:20\d{2})\s*[年./-]?\s*\d{1,2}(?:月|[./-]\d{1,2})?|至今|现在|present|current))?/gi;

/** 去掉时间片段后的标题词元 */
function headingTokens(heading: string): string[] {
  return heading
    .replace(DATE_BLOCK_RE, '')
    .replace(/20\d{2}/g, '')
    .split(/\s+|[,，、/|·•\-—.｜]+/)
    .map((s) => s.replace(/[（）()年月日号]/g, '').trim())
    .filter((s) => s && !/^\d+$/.test(s));
}

const DEGREE_RE = /(本科|硕士|博士|学士|研究生|大专|高职|中专|高中)/;

const RESP_LEAD = /^(职责|负责|承担|主导|独立|参与)\s*[:：]?/;
const LABEL_PREFIX = /^(?:职责|项目职责|描述|项目描述|简介|内容)\s*[:：]\s*/;

function nameFromHeading(heading: string): string {
  return clean(heading.replace(DATE_BLOCK_RE, '').replace(/[-—–·|]\s*$/, '')).slice(0, 80);
}

function parseInstanceBlocks(kind: FieldKey, lines: string[]): ExperienceBlock[] {
  const instances = splitInstances(lines);
  const out: ExperienceBlock[] = [];
  for (const inst of instances) {
    if (!inst.heading && inst.body.length === 0) continue;
    const fields: ExperienceBlockField[] = [];
    const allText = [inst.heading, ...inst.body].join('\n');
    const period = extractPeriod(allText);
    if (period) pushField(fields, 'period', period);
    const bodyDefault = inst.body.join('\n').trim();

    if (kind === 'internship_experience' || kind === 'work_experience') {
      // 固定四字段：公司 / 岗位(角色) / 时间段 / 经历描述
      const toks = headingTokens(inst.heading);
      const roleCandidates = toks.filter((t) =>
        /(实习|工程师|开发|产品|运营|设计|测试|算法|数据|前端|后端|项目经理|助理|intern|engineer|analyst)/i.test(
          t,
        ),
      );
      const isRole = new Set(roleCandidates);
      const company =
        toks.find((t) => !isRole.has(t) && !/^(在|于)$/.test(t)) ??
        inst.heading.split(/\s+/)[0] ??
        '';
      if (company) pushField(fields, 'company', clean(company));
      if (roleCandidates.length) {
        pushField(fields, 'role', roleCandidates.join(' '));
      } else if (company) {
        // 没有明显岗位词：把公司词之外的首个词当岗位，避免整行丢失
        const other = toks.find((t) => t !== company);
        if (other) pushField(fields, 'role', other);
      }
      // 标题里剩下的信息（如“市场部”）归入描述，不凭空造字段
      const leftover = toks.filter((t) => t !== company && !isRole.has(t));
      const descParts: string[] = [];
      if (leftover.length) descParts.push(leftover.join(' '));
      if (bodyDefault) descParts.push(bodyDefault);
      const desc = descParts.filter(Boolean).join('\n').trim();
      if (desc) pushField(fields, 'description', desc);
    } else if (kind === 'project_experience') {
      // 固定三字段：项目名称 / 项目职责 / 项目描述
      const name = nameFromHeading(inst.heading);
      if (name) pushField(fields, 'name', name);
      const respLines: string[] = [];
      const descLines: string[] = [];
      for (const rawBody of inst.body) {
        const line = rawBody.trim();
        if (!line) continue;
        if (RESP_LEAD.test(line)) {
          respLines.push(line.replace(RESP_LEAD, '').trim() || line);
        } else {
          descLines.push(line.replace(LABEL_PREFIX, ''));
        }
      }
      if (respLines.length) pushField(fields, 'responsibility', respLines.join('\n'));
      if (descLines.length) pushField(fields, 'description', descLines.join('\n'));
    } else if (kind === 'edu_experience') {
      const toks = headingTokens(inst.heading);
      const school = toks.find((t) => /(大学|学院|学校|School|University|College)/i.test(t)) ?? '';
      if (school) pushField(fields, 'school', school);
      const deg = allText.match(DEGREE_RE);
      if (deg && deg[1]) pushField(fields, 'degree', deg[1]);
      const major =
        toks.find((t) => t !== school && !DEGREE_RE.test(t) && !/^\d+$/.test(t)) ?? '';
      if (major) pushField(fields, 'major', major);
      if (bodyDefault) pushField(fields, 'description', bodyDefault);
    } else {
      // campus / awards 等：整段归入描述
      if (bodyDefault) pushField(fields, 'description', bodyDefault);
    }

    if (fields.length === 0) {
      if (inst.heading) pushField(fields, 'description', inst.heading);
      else continue;
    }
    out.push({
      id: `blk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      kind,
      heading: inst.heading || undefined,
      fields,
      updatedAt: Date.now(),
    });
  }
  return out;
}

export function parseResumeText(raw: string): ParseResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 1) 定位区块标题与范围
  const ranges: { start: number; end: number; key: FieldKey }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const idx = isHeaderLine(lines[i]!);
    if (idx < 0) continue;
    const key = SECTION_RULES[idx]!.key;
    const last = ranges[ranges.length - 1];
    if (last) last.end = i;
    ranges.push({ start: i, end: lines.length, key });
  }

  const consumed = new Set<number>();
  for (const r of ranges) consumed.add(r.start);

  // 2) 标量抽取：只处理区块外的行
  const scalarEntries: ParsedEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    if (ranges.some((r) => i > r.start && i < r.end)) continue;
    const line = lines[i]!;
    let matched = false;
    for (const rule of SCALAR_RULES) {
      const m = line.match(rule.re);
      if (!m) continue;
      const value = rule.pick ? rule.pick(m, line) : clean(m[1] ?? '');
      if (value) {
        scalarEntries.push({ fieldKey: rule.key, value });
        consumed.add(i);
      }
      matched = true;
      break;
    }
    if (!matched) {
      const mob = line.match(/(^|[^0-9])(1[3-9]\d{9})($|[^0-9])/);
      if (mob) {
        scalarEntries.push({ fieldKey: 'mobile', value: mob[2]! });
        consumed.add(i);
        continue;
      }
      const mail = line.match(/([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/);
      if (mail) {
        scalarEntries.push({ fieldKey: 'email', value: mail[1]! });
        consumed.add(i);
        continue;
      }
    }
  }

  // 3) 区块 → 整段粗条目 + 结构化实例块
  const sectionEntries: ParsedEntry[] = [];
  const blocks: ExperienceBlock[] = [];
  for (const r of ranges) {
    const body = lines
      .slice(r.start + 1, r.end)
      .filter((_, idx) => !consumed.has(r.start + 1 + idx))
      .join('\n')
      .trim();
    if (body) {
      // 整段值=正文（不带“实习经历/教育经历”等标题头，避免填入页面时重复标题）
      sectionEntries.push({ fieldKey: r.key, value: body, multi: true });
    }
    if (isBlockKind(r.key)) {
      const inner = lines.slice(r.start + 1, r.end).filter(Boolean);
      if (inner.length) {
        blocks.push(...parseInstanceBlocks(r.key, inner));
      }
    }
  }

  // 4) 未消费的非空行 → unmatched
  const unmatched: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    if (ranges.some((r) => i > r.start && i < r.end)) continue;
    unmatched.push(lines[i]!);
    if (unmatched.length >= 20) break;
  }

  // 5) 兜底：简历开头常是光秃秃的姓名（如第一行“张三”）。
  if (!scalarEntries.some((e) => e.fieldKey === 'name')) {
    const first = unmatched.find(
      (l) =>
        l.length <= 24 &&
        !/[0-9@]/.test(l) &&
        !/^(简历|个人简历|求职简历|姓名|求职|应聘|目\s*录|RESUME|CURRICULUM)/i.test(l) &&
        !l.includes('：') &&
        !l.includes(':'),
    );
    if (first) {
      scalarEntries.unshift({ fieldKey: 'name', value: first });
      const idx = unmatched.indexOf(first);
      if (idx >= 0) unmatched.splice(idx, 1);
    }
  }

  return { entries: [...scalarEntries, ...sectionEntries], blocks, unmatched: unmatched.slice(0, 10) };
}
