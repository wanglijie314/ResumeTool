/**
 * 自定义字段键工具测试：npx tsx scripts/keys-test.ts
 */
import { customKeyOfName, customNameOfKey, isCustomKey } from '../src/shared/keys';

let pass = 0;
let fail = 0;
const check = (cond: boolean, msg: string): void => {
  if (cond) pass++;
  else {
    fail++;
    console.log('  ✗ ' + msg);
  }
};

const name = '居住城市';
const key = customKeyOfName(name);
check(key.startsWith('custom:'), 'key 带 custom: 前缀');
check(isCustomKey(key), 'isCustomKey 识别');
check(!isCustomKey('school'), '内置键不是自定义键');
check(customNameOfKey(key) === name, `名称还原：${customNameOfKey(key)}`);

const tricky = '居住城市（含 空格/符号:@#）';
check(customNameOfKey(customKeyOfName(tricky)) === tricky, '特殊字符名称可往返还原');
check(customNameOfKey('school') === 'school', '非自定义键原样返回');

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail > 0 ? 1 : 0);
