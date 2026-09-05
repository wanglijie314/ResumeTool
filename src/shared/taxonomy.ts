/**
 * 简历信息分类体系（taxonomy）：扩展认识的所有"字段类型"。
 * 内置词典的匹配目标、档案存储的键、管理页的分组都来源于这里。
 */

export const FIELD_GROUPS = [
  { key: 'basic', zh: '基本信息' },
  { key: 'contact', zh: '联系方式' },
  { key: 'identity', zh: '证件信息' },
  { key: 'education', zh: '教育经历' },
  { key: 'language', zh: '语言成绩' },
  { key: 'work', zh: '实习与工作经历' },
  { key: 'project', zh: '项目经历' },
  { key: 'campus', zh: '校园与证书' },
  { key: 'expectation', zh: '求职意向' },
  { key: 'misc', zh: '其他' },
] as const;

export type FieldGroupKey = (typeof FIELD_GROUPS)[number]['key'];

export interface FieldDef {
  /** 唯一键，同时作为档案字段 key 与学习规则的落点 */
  key: string;
  /** 中文名，用于识别面板与管理页 */
  zh: string;
  group: FieldGroupKey;
  /** 高敏感（身份证等）→ 填写前需要用户确认 */
  sensitive: boolean;
  valueType:
    | 'text'
    | 'longtext'
    | 'single-choice'
    | 'date'
    | 'number'
    | 'multi-value'
    | 'file';
}

export const FIELD_DEFS = [
  // —— 基本信息 ——
  { key: 'name', zh: '姓名', group: 'basic', sensitive: false, valueType: 'text' },
  { key: 'gender', zh: '性别', group: 'basic', sensitive: false, valueType: 'single-choice' },
  { key: 'birth_date', zh: '出生日期', group: 'basic', sensitive: false, valueType: 'date' },
  { key: 'native_place', zh: '籍贯', group: 'basic', sensitive: false, valueType: 'text' },
  { key: 'ethnicity', zh: '民族', group: 'basic', sensitive: false, valueType: 'single-choice' },
  { key: 'political_status', zh: '政治面貌', group: 'basic', sensitive: false, valueType: 'single-choice' },
  { key: 'marital_status', zh: '婚姻状况', group: 'basic', sensitive: false, valueType: 'single-choice' },
  { key: 'photo', zh: '照片/头像', group: 'basic', sensitive: false, valueType: 'file' },

  // —— 联系方式 ——
  { key: 'mobile', zh: '手机号码', group: 'contact', sensitive: false, valueType: 'text' },
  { key: 'home_phone', zh: '家庭电话/座机', group: 'contact', sensitive: false, valueType: 'text' },
  { key: 'email', zh: '邮箱', group: 'contact', sensitive: false, valueType: 'text' },
  { key: 'wechat', zh: '微信号', group: 'contact', sensitive: false, valueType: 'text' },
  { key: 'qq', zh: 'QQ号', group: 'contact', sensitive: false, valueType: 'text' },

  // —— 证件信息 ——
  { key: 'id_type', zh: '证件类型', group: 'identity', sensitive: false, valueType: 'single-choice' },
  { key: 'id_card', zh: '身份证号', group: 'identity', sensitive: true, valueType: 'text' },
  { key: 'passport_no', zh: '护照号', group: 'identity', sensitive: true, valueType: 'text' },

  // —— 教育经历 ——
  { key: 'school', zh: '毕业院校', group: 'education', sensitive: false, valueType: 'text' },
  { key: 'faculty', zh: '院系', group: 'education', sensitive: false, valueType: 'text' },
  { key: 'degree', zh: '学历/学位', group: 'education', sensitive: false, valueType: 'single-choice' },
  { key: 'major', zh: '专业', group: 'education', sensitive: false, valueType: 'text' },
  { key: 'study_years', zh: '学制/年限', group: 'education', sensitive: false, valueType: 'text' },
  { key: 'class_rank', zh: '成绩排名', group: 'education', sensitive: false, valueType: 'text' },
  { key: 'edu_period', zh: '在校起止时间', group: 'education', sensitive: false, valueType: 'text' },
  { key: 'graduate_year', zh: '毕业时间', group: 'education', sensitive: false, valueType: 'text' },
  { key: 'gpa', zh: '绩点(GPA)', group: 'education', sensitive: false, valueType: 'text' },
  { key: 'edu_experience', zh: '教育经历(多段)', group: 'education', sensitive: false, valueType: 'multi-value' },

  // —— 语言成绩 ——
  { key: 'cet4_score', zh: '英语四级成绩', group: 'language', sensitive: false, valueType: 'text' },
  { key: 'cet6_score', zh: '英语六级成绩', group: 'language', sensitive: false, valueType: 'text' },
  { key: 'toefl_score', zh: '托福成绩', group: 'language', sensitive: false, valueType: 'text' },
  { key: 'ielts_score', zh: '雅思成绩', group: 'language', sensitive: false, valueType: 'text' },
  { key: 'other_language', zh: '其他语言能力', group: 'language', sensitive: false, valueType: 'text' },

  // —— 实习与工作经历 ——
  { key: 'internship_experience', zh: '实习经历', group: 'work', sensitive: false, valueType: 'multi-value' },
  { key: 'work_experience', zh: '工作经历', group: 'work', sensitive: false, valueType: 'multi-value' },
  { key: 'current_company', zh: '现任职单位', group: 'work', sensitive: false, valueType: 'text' },

  // —— 项目经历 ——
  { key: 'project_experience', zh: '项目经历', group: 'project', sensitive: false, valueType: 'multi-value' },

  // —— 校园与证书 ——
  { key: 'campus_experience', zh: '校园经历', group: 'campus', sensitive: false, valueType: 'multi-value' },
  { key: 'awards', zh: '获奖经历', group: 'campus', sensitive: false, valueType: 'multi-value' },
  { key: 'skills', zh: '专业技能/证书', group: 'campus', sensitive: false, valueType: 'text' },

  // —— 求职意向 ——
  { key: 'expect_city', zh: '期望城市', group: 'expectation', sensitive: false, valueType: 'text' },
  { key: 'expect_position', zh: '期望职位/岗位', group: 'expectation', sensitive: false, valueType: 'text' },
  { key: 'expect_salary', zh: '期望薪资', group: 'expectation', sensitive: false, valueType: 'text' },
  { key: 'job_type', zh: '工作性质(全职/实习等)', group: 'expectation', sensitive: false, valueType: 'single-choice' },
  { key: 'available_date', zh: '到岗时间', group: 'expectation', sensitive: false, valueType: 'text' },

  // —— 其他 ——
  { key: 'referral_code', zh: '内推码', group: 'misc', sensitive: false, valueType: 'text' },
  { key: 'channel', zh: '信息来源渠道', group: 'misc', sensitive: false, valueType: 'text' },
  { key: 'self_eval', zh: '自我评价', group: 'misc', sensitive: false, valueType: 'longtext' },
] as const satisfies readonly FieldDef[];

export type FieldKey = (typeof FIELD_DEFS)[number]['key'];

const DEF_BY_KEY = new Map<string, FieldDef>(FIELD_DEFS.map((d) => [d.key, d]));

export function fieldDef(key: string): FieldDef | undefined {
  return DEF_BY_KEY.get(key);
}

export function fieldZh(key: string): string {
  return DEF_BY_KEY.get(key)?.zh ?? key;
}

export function groupZh(group: FieldGroupKey): string {
  return FIELD_GROUPS.find((g) => g.key === group)?.zh ?? group;
}

export const SENSITIVE_KEYS = new Set<string>(
  FIELD_DEFS.filter((d) => d.sensitive).map((d) => d.key),
);
