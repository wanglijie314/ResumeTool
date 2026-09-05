/**
 * M4 行模板基础：把页面"行内字段标签文本"归一到行角色（RowRole），
 * 把区块标题文本归一到经历大类（FieldKey）。
 * 行角色与解析器的 ExperienceRole 对齐，另拆出 start/end/period 时间角色。
 */
import { normalizeText } from './normalize';
import type { FieldKey } from './taxonomy';

export type RowRole =
  | 'start'
  | 'end'
  | 'period'
  | 'company'
  | 'role'
  | 'name'
  | 'responsibility'
  | 'description'
  | 'school'
  | 'major'
  | 'degree'
  | 'department'
  | 'other';

export const ROW_ROLE_ZH: Record<RowRole, string> = {
  start: '开始时间',
  end: '结束时间',
  period: '时间段',
  company: '公司/企业',
  role: '职位/岗位',
  name: '名称',
  responsibility: '职责',
  description: '描述/内容',
  school: '学校/院校',
  major: '专业',
  degree: '学历/学位',
  department: '部门',
  other: '其它',
};

/** 判定顺序：先专后泛（如 开始时间 命中在 时间 之前） */
const ROLE_PHRASES: { role: RowRole; phrases: string[] }[] = [
  { role: 'start', phrases: ['开始时间', '开始日期', '起始时间', '起始年月', '开始年月', 'startdate', 'start'] },
  { role: 'end', phrases: ['结束时间', '结束日期', '截止时间', '终止时间', '结束年月', 'enddate', 'end'] },
  { role: 'period', phrases: ['时间段', '时间范围', '起止时间', '起止年月', '在职时间', '在校时间', '期间', '期限', '年月范围', 'period'] },
  { role: 'company', phrases: ['企业名称', '公司名称', '实习公司', '实习单位', '工作单位', '公司', '企业', '单位', 'employer', 'organization', 'company'] },
  { role: 'role', phrases: ['职位名称', '实习岗位', '岗位名称', '担任职位', '职务', '职位', '岗位', 'title', 'position'] },
  { role: 'name', phrases: ['项目名称', '项目标题', '项目名', '名称', 'name', 'title', 'projectname'] },
  { role: 'responsibility', phrases: ['项目职责', '职责描述', '工作职责', '职责', '负责内容', '承担内容', 'responsibility'] },
  { role: 'description', phrases: ['工作描述', '项目描述', '经历描述', '实习内容', '实习描述', '实践内容', '主要工作', '工作内容', '项目简介', '描述', '简介', '说明', '内容', 'description'] },
  { role: 'school', phrases: ['毕业院校', '学校名称', '所在学校', '学校', '院校', 'university', 'college', 'school'] },
  { role: 'major', phrases: ['所学专业', '专业名称', '专业', 'major'] },
  { role: 'degree', phrases: ['最高学历', '最高学位', '学历', '学位', 'degree'] },
  { role: 'department', phrases: ['部门', '事业部', '院系', '系所', '团队', 'department', 'faculty'] },
  { role: 'other', phrases: ['备注', '其它', '其他', '班级职务', '是否', 'note', 'remark', 'memo'] },
];

/** 把行内字段文本归一到行角色（归一化后做包含匹配；无命中返回 null） */
export function rowRoleOfText(text: string | null | undefined): RowRole | null {
  if (!text) return null;
  const norm = normalizeText(text);
  if (!norm) return null;
  for (const { role, phrases } of ROLE_PHRASES) {
    if (phrases.some((p) => norm.includes(normalizeText(p)))) return role;
  }
  return null;
}

/** 经验组合大类 → 期望的行角色顺序（用于把 blocks 子字段对位到模板） */
export const KIND_ROWS: Partial<Record<FieldKey, RowRole[]>> = {
  internship_experience: ['start', 'end', 'company', 'role', 'department', 'description'],
  work_experience: ['start', 'end', 'company', 'role', 'department', 'description'],
  project_experience: ['start', 'end', 'name', 'responsibility', 'description'],
  edu_experience: ['start', 'end', 'school', 'major', 'degree', 'description'],
  campus_experience: ['start', 'end', 'name', 'description'],
  awards: ['name', 'description'],
};

/** 区块标题文本 → 经历大类（无命中 null） */
export function kindOfHeading(text: string): FieldKey | null {
  const norm = normalizeText(text);
  if (!norm) return null;
  const list: { kind: FieldKey; words: string[] }[] = [
    { kind: 'edu_experience', words: ['教育', '培训'] },
    { kind: 'internship_experience', words: ['实习'] },
    { kind: 'work_experience', words: ['工作'] },
    { kind: 'project_experience', words: ['项目'] },
    { kind: 'campus_experience', words: ['校园', '学生', '社团'] },
    { kind: 'awards', words: ['获奖', '荣誉', '奖项'] },
  ];
  for (const item of list) {
    if (item.words.some((w) => norm.includes(normalizeText(w)))) return item.kind;
  }
  return null;
}

/** 时间类角色：填“时间段”值时应拆 start/end 或按模板只写一侧 */
export function isDateRole(role: RowRole): boolean {
  return role === 'start' || role === 'end' || role === 'period';
}

/** 把 blocks 的单条 period（如 2021.07-2021.10）拆成 start/end */
export function splitPeriod(period: string): { start?: string; end?: string } {
  const parts = period.split(/\s*(?:[-~至到—–]{1,2})\s*/);
  return { start: parts[0] ? parts[0].trim() : undefined, end: parts[1] ? parts[1].trim() : undefined };
}
