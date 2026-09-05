/**
 * 分类器/词典逻辑测试（Node 直跑，无浏览器依赖）：
 *   npx tsx scripts/classify-test.ts
 */
import { classify } from '../src/content/classifier';
import { normalizeText } from '../src/shared/normalize';
import { customKeyOfName } from '../src/shared/keys';
import type { FieldCandidate, WordMapping } from '../src/shared/types';
import type { FieldKey } from '../src/shared/taxonomy';

function mk(label: string, extra: Partial<FieldCandidate> = {}): FieldCandidate {
  return {
    id: 't',
    tag: 'input',
    inputType: 'text',
    labelText: label,
    labelSources: label ? [{ text: label, how: 'label-for' }] : [],
    placeholder: '',
    name: '',
    idAttr: '',
    ariaLabel: '',
    optionTexts: [],
    required: false,
    readonly: false,
    disabled: false,
    haystack: normalizeText(label),
    ...extra,
  };
}

const CTX = { learned: [] as WordMapping[] };

let pass = 0;
let fail = 0;
const failures: string[] = [];

function expectKey(label: string, want: FieldKey | null, minConf = 0.7, extra: Partial<FieldCandidate> = {}) {
  const r = classify(mk(label, extra), CTX);
  const got = r.fieldKey;
  const ok = got === want && (want === null || r.confidence >= minConf);
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(
      `「${label}」期望 ${want}${want ? `(≥${minConf})` : ''}，实际 ${got ?? 'null'}(conf=${r.confidence.toFixed(2)})，依据: ${r.reasons.join(' | ')}`,
    );
  }
}

function expectIgnored(label: string) {
  const r = classify(mk(label), CTX);
  const ok = r.fieldKey === null && r.reasons.includes('#ignore#');
  if (ok) pass++;
  else {
    fail++;
    failures.push(`「${label}」应被忽略，实际 fieldKey=${r.fieldKey} reasons=${r.reasons.join('|')}`);
  }
}

// —— 词典正向命中 ——
expectKey('姓名', 'name', 0.9);
expectKey('手机号码', 'mobile', 0.9);
expectKey('联系电话', 'mobile', 0.85);
expectKey('电子邮箱', 'email', 0.9);
expectKey('微信号', 'wechat', 0.9);
expectKey('身份证号', 'id_card', 0.95);
expectKey('身份证号码', 'id_card', 0.95);
expectKey('证件号码', 'id_card', 0.6);
expectKey('出生日期', 'birth_date', 0.9);
expectKey('籍贯', 'native_place', 0.9);
expectKey('民族', 'ethnicity', 0.9);
expectKey('政治面貌', 'political_status', 0.9);
expectKey('证件类型', 'id_type', 0.9);
expectKey('家庭电话', 'home_phone', 0.8);
expectKey('毕业院校', 'school', 0.95);
expectKey('院系', 'faculty', 0.85);
expectKey('学制', 'study_years', 0.85);
expectKey('成绩排名', 'class_rank', 0.85);
expectKey('意向工作地', 'expect_city', 0.95);
expectKey('期望年薪', 'expect_salary', 0.8);
expectKey('招聘类型', 'job_type', 0.9);
expectKey('最高学历', 'degree', 0.85);
expectKey('所学专业', 'major', 0.9);
expectKey('专业', 'major', 0.7);
expectKey('毕业时间', 'graduate_year', 0.9);
expectKey('英语四级成绩', 'cet4_score', 0.95);
expectKey('英语六级成绩', 'cet6_score', 0.95);
expectKey('四级', 'cet4_score', 0.85);
expectKey('六级', 'cet6_score', 0.85);
expectKey('托福成绩', 'toefl_score', 0.95);
expectKey('雅思', 'ielts_score', 0.95);
expectKey('项目经历', 'project_experience', 0.95);
expectKey('实习经历', 'internship_experience', 0.95);
expectKey('工作经历', 'work_experience', 0.95);
expectKey('获奖经历', 'awards', 0.95);
expectKey('专业技能', 'skills', 0.9);
expectKey('自我评价', 'self_eval', 0.95);
expectKey('期望城市', 'expect_city', 0.95);
expectKey('期望工作地点', 'expect_city', 0.95);
expectKey('期望职位', 'expect_position', 0.95);
expectKey('求职意向', 'expect_position', 0.8);
expectKey('期望薪资', 'expect_salary', 0.95);
expectKey('可到岗时间', 'available_date', 0.9);
expectKey('内推码', 'referral_code', 0.9);
expectKey('招聘信息来源', 'channel', 0.85);
expectKey('教育经历', 'edu_experience', 0.95);

// —— 负向/噪音 ——
expectIgnored('图形验证码');
expectIgnored('验证码');
expectIgnored('用户名');
expectIgnored('搜索职位');
expectKey('工号', null, 0, { labelSources: [] });
expectKey('四六级成绩', null, 0); // 合并型字段 → 不猜测
expectKey('英语四六级（一个输入框合填）', null, 0);

// 专业技能不应误判为"专业"
{
  const r = classify(mk('专业技能'), CTX);
  if (r.fieldKey === 'skills') pass++;
  else {
    fail++;
    failures.push(`「专业技能」应归为 skills，实际 ${r.fieldKey}`);
  }
}

// —— 单选组选项兜底（无标签但有 男/女）——
{
  const r = classify(
    mk('', { tag: 'input', inputType: 'radio', optionTexts: ['男', '女'], labelSources: [] }),
    CTX,
  );
  // 无页面标签 → 置信度按规则压到中档(≤0.65)；0.6 起即算合格
  if (r.fieldKey === 'gender' && r.confidence >= 0.6) pass++;
  else {
    fail++;
    failures.push(`radio[男/女] 应兜底为 gender，实际 ${r.fieldKey}(conf=${r.confidence.toFixed(2)})`);
  }
}

// —— 用户词表（教学/别名，全局生效，最高优先级）——
{
  const learned: WordMapping[] = [
    {
      id: 'w1',
      labelKey: normalizeText('工号'),
      fieldKey: 'name',
      source: 'taught',
      createdAt: 1,
      updatedAt: 1,
      hits: 3,
    },
    {
      id: 'w2',
      labelKey: normalizeText('第一学历院校'),
      fieldKey: 'school',
      source: 'alias',
      createdAt: 1,
      updatedAt: 1,
      hits: 0,
    },
    {
      id: 'w3',
      labelKey: normalizeText('请输入工号'),
      fieldKey: 'name',
      source: 'taught',
      createdAt: 1,
      updatedAt: 1,
      hits: 0,
    },
  ];
  // 词表优先于内置词典
  const r = classify(mk('工号'), { learned });
  if (r.fieldKey === 'name' && r.basis === 'learned-rule' && r.confidence === 1) pass++;
  else {
    fail++;
    failures.push(`词表应覆盖内置词典，实际 ${r.fieldKey}(${r.basis})`);
  }
  // 别名来源同样命中（"第一学历院校"→school，词典不认识）
  const rA = classify(mk('第一学历院校'), { learned });
  if (rA.fieldKey === 'school' && rA.basis === 'learned-rule') pass++;
  else {
    fail++;
    failures.push(`别名词条应命中 school，实际 ${rA.fieldKey}(${rA.basis})`);
  }
  // 全局生效：换个站点一样命中
  const r2 = classify(mk('工号'), { learned });
  if (r2.fieldKey === 'name') pass++;
  else {
    fail++;
    failures.push('词表应全局生效（跨站点命中）');
  }
  // 占位符/无标签时按同一规则取键（教学浮层与识别同键；haystack 与真实扫描一致地含占位符）
  const r3 = classify(
    mk('', {
      labelText: '',
      placeholder: '请输入工号',
      name: '',
      haystack: normalizeText('请输入工号'),
    }),
    { learned },
  );
  if (r3.fieldKey === 'name') pass++;
  else {
    fail++;
    failures.push(`占位符线索应按词表命中 name，实际 ${r3.fieldKey}`);
  }
  // 站点忽略：命中 ignoredKeys 直接忽略（该站不再提示）
  const rIgn = classify(mk('在职状态'), { learned: [], ignoredKeys: new Set(['在职状态']) });
  if (rIgn.fieldKey === null && rIgn.reasons.includes('#ignore#')) pass++;
  else {
    fail++;
    failures.push(`本站忽略应返回 #ignore#，实际 ${rIgn.fieldKey}(${rIgn.reasons.join('|')})`);
  }
}

// —— 自定义字段：教学/词表可把页面文本映射到用户自定义键 ——
{
  const customKey = customKeyOfName('居住城市');
  const learned: WordMapping[] = [
    {
      id: 'w-c1',
      labelKey: normalizeText('现居住城市'),
      fieldKey: customKey,
      source: 'taught',
      createdAt: 1,
      updatedAt: 1,
      hits: 0,
    },
  ];
  const r = classify(mk('现居住城市'), { learned });
  if (r.fieldKey === customKey && r.basis === 'learned-rule') pass++;
  else {
    fail++;
    failures.push(`自定义字段应被词表命中，实际 ${r.fieldKey}(${r.basis})`);
  }
  const r2 = classify(mk('城市'), { learned });
  if (r2.fieldKey === null) pass++;
  else {
    fail++;
    failures.push(`未教过的相近文本不应误命中自定义字段，实际 ${r2.fieldKey}`);
  }
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n—— 失败明细 ——');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('分类器测试全部通过 ✅');
