/**
 * .docx 文本抽取冒烟测试：用 fflate 现场生成一个最小 docx，再走 extractDocxText。
 * 运行：npx tsx scripts/docx-test.ts
 */
import { strToU8, zipSync } from 'fflate';
import { extractDocxText } from '../src/shared/resumeFile';

const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>姓名：李四</w:t></w:r></w:p>
<w:p><w:r><w:t>手机：13912345678</w:t></w:r></w:p>
<w:p><w:r><w:t>教育经历</w:t></w:r></w:p>
<w:p><w:r><w:t>清华大学 2020.09-2024.06 计算机</w:t></w:r></w:p>
<w:p><w:r><w:t>期望城市：北京</w:t></w:r></w:p>
</w:body></w:document>`;

const zipped = zipSync({ 'word/document.xml': strToU8(xml) });
const buf =
  zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
const text = extractDocxText(buf);

let ok = true;
const must = ['姓名：李四', '13912345678', '教育经历', '清华大学', '期望城市：北京'];
for (const m of must) {
  if (!text.includes(m)) {
    ok = false;
    console.log('  ✗ 缺少: ' + m);
  }
}
console.log(text.split('\n').slice(0, 6).join('\n'));
console.log(ok ? 'docx 抽取测试通过 ✅' : 'docx 抽取测试失败 ❌');
process.exit(ok ? 0 : 1);
