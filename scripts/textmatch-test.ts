/**
 * 模糊匹配工具测试：npx tsx scripts/textmatch-test.ts
 */
import { bestMatchIndex, textSimilarity } from '../src/shared/textMatch';

let pass = 0;
let fail = 0;
const check = (cond: boolean, msg: string): void => {
  if (cond) pass++;
  else {
    fail++;
    console.log('  ✗ ' + msg);
  }
};

check(textSimilarity('本科', '本科') === 1, '完全相同=1');
check(textSimilarity('本科', '本科学历') >= 0.8, '包含关系高相似');
check(textSimilarity('本科', '硕士') < 0.6, '不同学历低相似');
check(textSimilarity('本科', '计算机') < 0.6, '无关词低相似');

const options = [{ text: '大专' }, { text: '大学本科' }, { text: '硕士' }, { text: '博士' }];
check(bestMatchIndex(options, '本科') === 1, '本科 → 大学本科');
check(bestMatchIndex(options, '硕士') === 2, '硕士 → 硕士');

// 明确的反例：不应选到完全无关的
const far = bestMatchIndex([{ text: '男' }, { text: '女' }], '本科');
check(far === null, '无相近选项应返回 null');

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail > 0 ? 1 : 0);
