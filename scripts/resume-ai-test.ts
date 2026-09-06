/**
 * resume-extract skill 单测：允许键/契约解析/严格校验/合并决策。
 * 运行：npx tsx scripts/resume-ai-test.ts
 */
import {
  RESUME_SCALAR_FIELDS,
  RESUME_SCALAR_KEYS,
  RESUME_TEXT_CAP,
  buildResumeExtractSystem,
  buildResumeExtractUser,
  decideResumeAdditions,
  parseResumeExtractJson,
} from '../src/skills/resume-extract';

let pass = 0;
let fail = 0;
const check = (cond: boolean, msg: string): void => {
  if (cond) pass++;
  else {
    fail++;
    console.log('  ✗ ' + msg);
  }
};

// 1) 允许键：排除整段经历大类与照片，保留标量（含 longtext 自我评价）
check(!RESUME_SCALAR_KEYS.has('internship_experience'), '整段实习经历不属于标量补全键');
check(!RESUME_SCALAR_KEYS.has('edu_experience'), '整段教育经历不属于标量补全键');
check(!RESUME_SCALAR_KEYS.has('awards'), '整段获奖不属于标量补全键');
check(!RESUME_SCALAR_KEYS.has('photo'), '照片键被排除');
check(RESUME_SCALAR_KEYS.has('mobile'), '手机号可补');
check(RESUME_SCALAR_KEYS.has('self_eval'), '自我评价(longtext)可补');
check(RESUME_SCALAR_KEYS.has('wechat'), '微信号可补');
check(RESUME_SCALAR_KEYS.has('expect_city'), '期望城市可补');
check(RESUME_SCALAR_FIELDS.length > 20, `标量字段量 ${RESUME_SCALAR_FIELDS.length}`);

// 2) skill 文本包含枚举与“只输出 JSON”约束
const sys = buildResumeExtractSystem(RESUME_SCALAR_FIELDS.slice(0, 3));
check(sys.includes('name=姓名') && sys.includes('gender=性别'), '系统提示含键枚举');
check(sys.includes('"results"') && sys.includes('JSON'), '系统提示要求 JSON 结构');
const user = buildResumeExtractUser('姓名：张三\n党员', [
  { fieldKey: 'name', value: '张三' },
]);
check(user.includes('党员'), '用户输入含简历原文');
check(user.includes('name = 张三'), '用户输入含已解析字段上下文');

// 3) 原文超长截断
const longText = 'x'.repeat(RESUME_TEXT_CAP + 500);
check(buildResumeExtractUser(longText, []).includes('已截断'), '超长原文带截断说明');

// 4) 合法输出被接受
const parsed = parseResumeExtractJson(
  {
    results: [
      { key: 'wechat', value: 'wxid_abc', conf: 0.9 },
      { key: 'political_status', value: '党员', conf: 0.85 },
    ],
  },
  RESUME_SCALAR_KEYS,
);
check(parsed.length === 2, `两条合法补全被接受，实际 ${parsed.length}`);
check(parsed[0]?.key === 'wechat' && parsed[0]?.value === 'wxid_abc', '微信号补全');

// 5) 越权键/空值/超长被丢弃或截断
const bad = parseResumeExtractJson(
  {
    results: [
      { key: 'not-a-key', value: 'x', conf: 0.9 },
      { key: 'internship_experience', value: '整段', conf: 0.9 },
      { key: 'qq', value: '   ', conf: 0.9 },
      { key: 'qq', value: '1'.repeat(300), conf: 0.9 },
      { key: 'name', value: '张三', conf: 2.5 },
    ],
  },
  RESUME_SCALAR_KEYS,
);
check(bad.length === 2, `仅 2 条合法（qq 截断 + name），实际 ${bad.length}`);
check(bad.some((b) => b.key === 'qq' && b.value.length === 200), '非 longtext 值截断到 200');
check(bad.some((b) => b.key === 'name' && b.conf === 1), 'conf 夹到 0~1');

// 6) 同一键重复只留高 conf
const dup = parseResumeExtractJson(
  { results: [{ key: 'email', value: 'a@b.com', conf: 0.6 }, { key: 'email', value: 'c@d.com', conf: 0.95 }] },
  RESUME_SCALAR_KEYS,
);
check(dup.length === 1 && dup[0]?.value === 'c@d.com', '重复键保留高 conf 值');

// 7) longtext（self_eval）保留换行且上限更大
const long = parseResumeExtractJson(
  { results: [{ key: 'self_eval', value: '第一行\n第二行' + '很'.repeat(5000), conf: 0.8 }] },
  RESUME_SCALAR_KEYS,
);
check(long[0]?.value.includes('\n'), 'longtext 保留换行');
check(long[0]!.value.length <= 2000, `longtext 截断到 2000，实际 ${long[0]!.value.length}`);

// 8) 合并决策：缺失→added；已有低把握→丢弃；已有高把握→overridden
const exist = [
  { fieldKey: 'name', value: '张三' },
  { fieldKey: 'mobile', value: '13800000000' },
];
const res = decideResumeAdditions(exist, [
  { key: 'wechat', value: 'wxid', conf: 0.9 },
  { key: 'name', value: '李四', conf: 0.5 },
  { key: 'mobile', value: '13911112222', conf: 0.95 },
]);
check(res.decisions.length === 2, `2 条决策（wechat+mobile），实际 ${res.decisions.length}`);
check(res.dropped === 1, `低把握 name 覆盖被丢弃，实际 ${res.dropped}`);
const addWechat = res.decisions.find((d) => d.key === 'wechat');
check(addWechat?.kind === 'added', '缺失键 → added');
const overMobile = res.decisions.find((d) => d.key === 'mobile');
check(overMobile?.kind === 'overridden' && overMobile?.value === '13911112222', '已有键高把握 → overridden');

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail > 0 ? 1 : 0);
