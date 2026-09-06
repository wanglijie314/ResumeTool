/**
 * AI 底座单测：page-match 契约解析/键校验/字段名校验。
 * 运行：npx tsx scripts/ai-test.ts
 */
import {
  buildPageMatchSystem,
  buildPageMatchUser,
  parsePageMatchJson,
} from '../src/skills/page-match';
import { customKeyOfName } from '../src/shared/keys';

let pass = 0;
let fail = 0;
const check = (cond: boolean, msg: string): void => {
  if (cond) pass++;
  else {
    fail++;
    console.log('  ✗ ' + msg);
  }
};

const allowed = new Set<string>(['mobile', 'expect_salary', customKeyOfName('居住城市')]);

// 1) 合法 map / new / skip
const parsed = parsePageMatchJson(
  {
    results: [
      { n: 1, action: 'map', key: 'mobile', conf: 0.98 },
      { n: 2, action: 'new', newFieldName: '居住城市', conf: 0.9 },
      { n: 3, action: 'skip', conf: 0.5 },
    ],
  },
  3,
  allowed,
);
check(parsed.length === 3, '三条都被接受');
check(parsed[0]?.action === 'map' && parsed[0]?.key === 'mobile', 'map 命中 mobile');
check(parsed[1]?.action === 'new' && parsed[1]?.newFieldName === '居住城市', 'new 字段名');
check(parsed[2]?.action === 'skip', 'skip 保留');

// 2) 非法键/越界/未知 action 被过滤或降级
const bad = parsePageMatchJson(
  {
    results: [
      { n: 1, action: 'map', key: 'not-a-key', conf: 0.9 },
      { n: 99, action: 'map', key: 'mobile', conf: 0.9 },
      { n: 2, action: 'whatever', conf: 0.9 },
      { n: 3, action: 'new', newFieldName: '   ', conf: 0.9 },
    ],
  },
  3,
  allowed,
);
check(bad.length === 1, `仅剩 1 条合法建议，实际 ${bad.length}`);
check(bad[0]?.action === 'skip' || bad[0]?.n === 2, '未知 action 降级为 skip');

// 3) 自定义键可作为 map 目标
const custom = parsePageMatchJson(
  { results: [{ n: 1, action: 'map', key: customKeyOfName('居住城市'), conf: 0.95 }] },
  1,
  allowed,
);
check(custom[0]?.key === customKeyOfName('居住城市'), '自定义键可命中');

// 4) skill 内容包含枚举与“只输出 JSON”约束
const sys = buildPageMatchSystem(
  [
    { key: 'mobile', zh: '手机号码' },
    { key: 'expect_salary', zh: '期望薪资' },
  ],
  [customKeyOfName('居住城市')],
);
check(sys.includes('mobile=手机号码'), '系统提示含键枚举');
check(sys.includes('custom:'), '系统提示含自定义键说明');
check(sys.includes('JSON') && sys.includes('"results"'), '系统提示要求 JSON 结构');
const user = buildPageMatchUser([
  { index: 1, labelText: '手机号', placeholder: '', kindText: '文本' },
]);
check(user.includes('手机号'), '用户输入含标签');

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail > 0 ? 1 : 0);
