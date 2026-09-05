/**
 * 内置字段词典：把页面文本（归一化后：小写、去所有空白）映射到 taxonomy 字段键。
 * 每个规则带基础权重；分类器取所有命中规则的最高分，必要时叠加附加线索。
 *
 * 约定：
 * - rx 匹配的是去掉空白、小写后的文本（因此规则里不能有空格）。
 * - 同一字段可有多个不同权重的规则（更明确的叫法权重更高）。
 */
import type { FieldKey } from '../shared/taxonomy';

export interface DictRule {
  key: FieldKey;
  /** 命中时的基础置信度（0..1） */
  weight: number;
  rx: RegExp[];
}

/** 置信度分档阈值（用于面板徽标与后续自动填写决策） */
export const CONF = {
  high: 0.85,
  medium: 0.6,
  low: 0.4,
} as const;

export function confidenceLabel(c: number): string {
  if (c >= CONF.high) return '高';
  if (c >= CONF.medium) return '中';
  if (c >= CONF.low) return '低';
  return '极低';
}

/** 与招聘填写无关、直接忽略的控件文本（验证码/登录/搜索等） */
export const IGNORE_RX: RegExp[] = [
  /验证码|安全验证|图形验证|滑块验证|校验码|短信码|captcha/i,
  /用户名|账号|登录|注册|密码|手机验证/i,
  /搜索|查询职位|职位搜索|搜索职位|检索/i,
];

/** 英文或缩写等语义较弱、权重上限被压低的情况由分类器处理 */
export const BUILTIN_RULES: DictRule[] = [
  // —— 基本信息 ——
  { key: 'name', weight: 1, rx: [/姓名/, /真实姓名/, /yourname/, /fullname/] },
  { key: 'name', weight: 0.55, rx: [/name/] },
  { key: 'gender', weight: 1, rx: [/性别/, /姓别/, /gender/, /sex/] },
  { key: 'birth_date', weight: 1, rx: [/出生日期/, /出生年月/, /出生时间/, /生日/, /dateofbirth/, /birthday/] },
  { key: 'birth_date', weight: 0.7, rx: [/birth/, /dob/] },
  { key: 'native_place', weight: 1, rx: [/籍贯/] },
  { key: 'native_place', weight: 0.85, rx: [/生源地/, /户口所在地/, /户籍/] },
  { key: 'native_place', weight: 0.6, rx: [/hometown/, /nativeplace/] },
  { key: 'ethnicity', weight: 0.98, rx: [/民族/, /ethnicity/, /nationality/] },
  { key: 'political_status', weight: 1, rx: [/政治面貌/, /政治面目/] },
  { key: 'political_status', weight: 0.7, rx: [/politic/, /partyaffiliation/] },
  { key: 'marital_status', weight: 1, rx: [/婚姻状况/, /婚否/, /maritalstatus/] },

  // —— 联系方式 ——
  { key: 'mobile', weight: 1, rx: [/手机号/, /手机号码/, /移动电话/] },
  { key: 'mobile', weight: 0.9, rx: [/手机/, /联系电话/, /电话号码/] },
  { key: 'mobile', weight: 0.7, rx: [/电话/, /mobile/, /cellphone/, /phone/, /tel/] },
  { key: 'home_phone', weight: 0.85, rx: [/家庭电话/, /固定电话/, /座机/, /家庭联系电话/] },
  { key: 'email', weight: 1, rx: [/电子邮箱/, /电子邮件/, /邮箱/, /email/, /e-mail/, /mailbox/] },
  { key: 'wechat', weight: 0.95, rx: [/微信号/, /微信/, /wechat/, /weixin/] },
  { key: 'qq', weight: 0.9, rx: [/qq号/, /qq号码/, /qq/] },

  // —— 证件信息 ——
  { key: 'id_type', weight: 0.95, rx: [/证件类型/, /证件类别/, /idtype/] },
  { key: 'id_card', weight: 1, rx: [/身份证号/, /身份证号码/, /居民身份证/, /身份证/] },
  { key: 'id_card', weight: 0.78, rx: [/idcard/, /idnumber/, /idnumber/] },
  { key: 'id_card', weight: 0.7, rx: [/证件号码/] },
  { key: 'passport_no', weight: 0.95, rx: [/护照号/, /护照号码/, /passport/] },

  // —— 教育经历 ——
  { key: 'school', weight: 1, rx: [/毕业院校/, /毕业学校/, /毕业院校名称/, /院校名称/, /毕业学校名称/] },
  { key: 'school', weight: 0.92, rx: [/就读院校/, /就读学校/, /所在学校/, /学校名称/, /毕业大学/] },
  { key: 'school', weight: 0.7, rx: [/学校/, /院校/, /university/, /college/, /school/] },
  { key: 'faculty', weight: 0.9, rx: [/院系/, /所在院系/, /院系名称/, /department/] },
  { key: 'study_years', weight: 0.9, rx: [/学制/, /学习年限/, /学制年限/, /学制年份/] },
  { key: 'degree', weight: 0.92, rx: [/最高学历/, /学历层次/, /学历/, /学位/, /教育程度/, /degree/, /educationlevel/] },
  { key: 'major', weight: 0.95, rx: [/所学专业/, /专业名称/, /主修专业/, /最高学历专业/, /专业类别/] },
  { key: 'major', weight: 0.8, rx: [/专业(?!技能|证书|资格|排名|竞赛)/, /major/] },
  { key: 'graduate_year', weight: 0.95, rx: [/毕业时间/, /毕业年份/, /毕业年月/, /毕业年度/, /预计毕业/, /graduation/] },
  { key: 'graduate_year', weight: 0.6, rx: [/毕业年/, /gradyear/] },
  { key: 'gpa', weight: 0.98, rx: [/绩点/, /平均学分绩点/, /学分绩点/, /gpa/] },
  { key: 'class_rank', weight: 0.9, rx: [/成绩排名/, /综合排名/, /专业排名/, /班级排名/, /年级排名/, /绩点排名/] },
  { key: 'edu_experience', weight: 1, rx: [/教育经历/, /教育背景/, /教育及培训经历/] },
  { key: 'edu_experience', weight: 0.7, rx: [/educationexperience/, /educationbackground/] },

  // —— 语言成绩 ——
  { key: 'cet4_score', weight: 1, rx: [/英语四级/, /大学英语四级/, /四级成绩/, /cet4/] },
  { key: 'cet4_score', weight: 0.95, rx: [/四级(?!级)/] },
  { key: 'cet6_score', weight: 1, rx: [/英语六级/, /大学英语六级/, /六级成绩/, /cet6/] },
  { key: 'cet6_score', weight: 0.95, rx: [/(?<!四)六级/] },
  { key: 'toefl_score', weight: 1, rx: [/托福/, /toefl/] },
  { key: 'ielts_score', weight: 1, rx: [/雅思/, /ielts/] },
  { key: 'other_language', weight: 0.85, rx: [/外语水平/, /英语水平/, /其他语言/, /第二外语/, /语言能力/, /英语能力/, /外语能力/] },

  // —— 实习与工作经历 ——
  { key: 'internship_experience', weight: 1, rx: [/实习经历/, /实习经验/, /实习实践/, /internshipexperience/] },
  { key: 'internship_experience', weight: 0.8, rx: [/实习/] },
  { key: 'work_experience', weight: 1, rx: [/工作经历/, /工作履历/, /工作经验/, /职业经历/] },
  { key: 'work_experience', weight: 0.7, rx: [/workexperience/, /employmenthistory/] },
  { key: 'current_company', weight: 0.9, rx: [/现任职公司/, /现任职单位/, /当前公司/, /目前就职/, /currentcompany/] },

  // —— 项目经历 ——
  { key: 'project_experience', weight: 1, rx: [/项目经历/, /项目经验/, /项目实践/] },
  { key: 'project_experience', weight: 0.8, rx: [/项目描述/, /项目简介/, /project/] },

  // —— 校园与证书 ——
  { key: 'campus_experience', weight: 1, rx: [/校园经历/, /学生工作经历/, /学生干部经历/, /社团经历/] },
  { key: 'campus_experience', weight: 0.85, rx: [/校园实践/, /学生活动经历/, /校园活动/] },
  { key: 'awards', weight: 1, rx: [/获奖经历/, /获奖情况/, /所获奖项/, /获奖记录/] },
  { key: 'awards', weight: 0.8, rx: [/奖项/, /荣誉/, /得奖/, /award/, /honor/] },
  { key: 'skills', weight: 0.95, rx: [/专业技能/, /职业技能/, /技能特长/, /资格证书/, /职业资格/, /专业证书/, /所获证书/] },
  { key: 'skills', weight: 0.7, rx: [/技能/, /证书/, /skill/, /certificate/] },

  // —— 求职意向 ——
  { key: 'expect_city', weight: 1, rx: [/期望城市/, /意向城市/, /期望工作地点/, /期望地点/, /目标城市/, /意向工作地/, /期望工作城市/, /期望工作地/] },
  { key: 'expect_city', weight: 0.8, rx: [/工作城市/, /意向地点/] },
  { key: 'expect_position', weight: 1, rx: [/期望职位/, /意向职位/, /期望岗位/, /意向岗位/, /应聘职位/, /目标职位/, /期望工作职位/] },
  { key: 'expect_position', weight: 0.85, rx: [/求职意向/] },
  { key: 'expect_salary', weight: 1, rx: [/期望薪资/, /期望薪酬/, /期望月薪/, /薪资要求/, /薪酬要求/, /期望待遇/] },
  { key: 'expect_salary', weight: 0.85, rx: [/期望年薪/, /期望年收入/] },
  { key: 'expect_salary', weight: 0.75, rx: [/salary/, /expectedsalary/] },
  { key: 'job_type', weight: 0.95, rx: [/工作性质/, /工作类型/, /求职类型/, /职位类型/, /期望工作类型/, /招聘类型/, /应聘类型/, /投递类型/, /招聘类别/, /招聘性质/] },
  { key: 'job_type', weight: 0.7, rx: [/全职/, /兼职/, /jobtype/, /fulltime/, /parttime/] },
  { key: 'available_date', weight: 0.95, rx: [/到岗时间/, /入职时间/, /可到岗/, /可入职/, /预计到岗/] },
  { key: 'available_date', weight: 0.6, rx: [/到岗/, /startdate/, /availabledate/] },

  // —— 其他 ——
  { key: 'referral_code', weight: 0.98, rx: [/内推码/, /内推口令/, /内推邀请码/, /推荐码/, /内推/] },
  { key: 'referral_code', weight: 0.6, rx: [/referral/] },
  { key: 'channel', weight: 0.9, rx: [/招聘信息来源/, /信息来源渠道/, /招聘渠道/, /获知渠道/, /投递渠道/, /从哪里了解/, /得知渠道/, /信息渠道/, /渠道来源/] },
  { key: 'self_eval', weight: 1, rx: [/自我评价/, /个人评价/, /个人陈述/, /自我介绍/, /个人简介/] },
  { key: 'self_eval', weight: 0.7, rx: [/selfeval/, /selfassessment/, /aboutme/, /selfintroduction/, /personalsummary/] },
];

/** 命中即视为合并型字段（例如"四六级成绩"），单独解释，避免误判 */
export const COMBINED_FIELD_RX = [/四六级/, /四、六级/, /四,六级/];
