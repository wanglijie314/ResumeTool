/**
 * 简历文本解析器单测：npx tsx scripts/resume-test.ts
 */
import { parseResumeText } from '../src/shared/resumeParser';

const SAMPLE = `
张三
手机：13812345678
邮箱：zhangsan@qq.com
身份证号：110101199001011234
民族：汉族
政治面貌：共青团员
毕业院校：北京大学
学历：本科
专业：计算机科学与技术
毕业时间：2022-06
英语六级成绩：560
绩点：3.8

教育经历
北京大学 计算机科学与技术 2018.09-2022.06
主修课程：数据结构、操作系统

项目经历
校园二手交易平台 2021.03-2021.08
负责后端开发，Spring Boot + MySQL
实现商品检索与详情页（多行描述示例）

个人博客系统 2020.09-2021.01
负责评论区与搜索模块
描述：基于 Vue + Node 搭建

实习经历
字节跳动 后端开发实习生 2021.07-2021.10
- 负责 xx 推荐系统性能优化
- 参与 2021 双十一大促稳定性保障

腾讯 产品运营实习生 2020.07-2020.12 市场部
- 协助社群运营与数据周报

技能特长
Java / Go / MySQL / Redis

自我评价
学习能力强，乐于协作，有责任心
`;

let pass = 0;
let fail = 0;
function expect(cond: boolean, msg: string): void {
  if (cond) pass++;
  else {
    fail++;
    console.log('  ✗ ' + msg);
  }
}

const { entries, blocks, unmatched } = parseResumeText(SAMPLE);
const find = (key: string) => entries.find((e) => e.fieldKey === key)?.value ?? '';

expect(find('name') === '张三', `name=张三，实际 ${find('name')}`);
expect(find('mobile') === '13812345678', `mobile，实际 ${find('mobile')}`);
expect(find('email') === 'zhangsan@qq.com', `email，实际 ${find('email')}`);
expect(find('id_card') === '110101199001011234', `id_card，实际 ${find('id_card')}`);
expect(find('ethnicity') === '汉族', `ethnicity，实际 ${find('ethnicity')}`);
expect(find('school') === '北京大学', `school，实际 ${find('school')}`);
expect(find('degree') === '本科', `degree，实际 ${find('degree')}`);
expect(find('major').includes('计算机') === true, `major 含计算机`);
expect(find('graduate_year').startsWith('2022'), `graduate_year，实际 ${find('graduate_year')}`);
expect(find('cet6_score') === '560', `cet6_score，实际 ${find('cet6_score')}`);
expect(find('gpa') === '3.8', `gpa，实际 ${find('gpa')}`);

const edu = find('edu_experience');
expect(edu.includes('北京大学') && edu.includes('2018.09'), '教育经历含学校与时间');
const proj = find('project_experience');
expect(proj.includes('校园二手交易平台') && proj.includes('个人博客系统'), '项目经历整段含两个项目');
const intern = find('internship_experience');
expect(intern.includes('字节跳动') && intern.includes('腾讯'), '实习经历整段含两家公司');
const skills = find('skills');
expect(skills.includes('Java'), '技能特长内容');
expect(find('self_eval').includes('学习能力强'), '自我评价内容');

// —— 结构化经历块：实例切分 + 子字段 ——
const internBlocks = blocks.filter((b) => b.kind === 'internship_experience');
expect(internBlocks.length === 2, `实习实例数应为 2，实际 ${internBlocks.length}`);
{
  const f0 = Object.fromEntries(internBlocks[0]?.fields.map((f) => [f.role, f.value]) ?? []);
  const f1 = Object.fromEntries(internBlocks[1]?.fields.map((f) => [f.role, f.value]) ?? []);
  expect(f0['company'] === '字节跳动', `实习1 实习公司=字节跳动，实际 ${f0['company']}`);
  expect((f0['role'] ?? '').includes('后端开发'), `实习1 实习岗位含后端开发，实际 ${f0['role']}`);
  expect((f0['period'] ?? '').includes('2021.07'), `实习1 实习时间段含2021.07，实际 ${f0['period']}`);
  expect((f0['description'] ?? '').includes('推荐系统'), '实习1 经历描述含推荐系统');
  expect(f1['company'] === '腾讯', `实习2 实习公司=腾讯，实际 ${f1['company']}`);
  expect((f1['role'] ?? '').includes('产品运营'), `实习2 实习岗位含产品运营，实际 ${f1['role']}`);
  expect((f1['period'] ?? '').includes('2020.07'), `实习2 时间段含2020.07，实际 ${f1['period']}`);
  const desc1 = f1['description'] ?? '';
  expect(desc1.includes('社群运营'), '实习2 经历描述含社群运营');
  expect(desc1.includes('市场部'), `实习2 剩余信息(市场部)应收进描述，实际 ${desc1}`);
  expect(f1['department'] === undefined, '实习不再拆出“部门”独立字段');
}
const projBlocks = blocks.filter((b) => b.kind === 'project_experience');
expect(projBlocks.length === 2, `项目实例数应为 2，实际 ${projBlocks.length}`);
{
  const m0 = new Map(projBlocks[0]?.fields.map((f) => [f.role, f.value]) ?? []);
  const m1 = new Map(projBlocks[1]?.fields.map((f) => [f.role, f.value]) ?? []);
  expect((m0.get('name') ?? '').startsWith('校园二手交易平台'), `项目1 名称，实际 ${m0.get('name')}`);
  expect((m0.get('responsibility') ?? '').includes('Spring Boot'), '项目1 职责含 Spring Boot');
  expect((m0.get('description') ?? '').includes('商品检索'), '项目1 描述含商品检索');
  expect((m1.get('name') ?? '').startsWith('个人博客系统'), `项目2 名称，实际 ${m1.get('name')}`);
  expect((m1.get('responsibility') ?? '').includes('评论区'), '项目2 职责含评论区');
  expect((m1.get('description') ?? '').includes('Vue'), '项目2 描述含 Vue');
  expect(!(m0.get('name') ?? '').includes('2021'), '项目名称不得夹带时间');
}

// —— 回归：带“成就小标题：…”的一段实习不应被拆成多段 ——
{
  const t = `
实习经历
字节跳动｜千川研发/质量团队 测试开发实习生 2026.05 - 2026.09
参与新功能的测试与质量保障；参与商家与运营平台TCC升级工作。
TCC自动化升级流水线：独立搭建TCC升级流水线，涉及13节点工作流，将升级周期从14
天压缩至7天，提效50%；确保部门100%按期完成迁移。
AI测试找回策略优化：参与设计AI自动化测试召回优化方案，围绕“文本相似度”构建评分机制。
BOE环境建设：参与35个服务的千川BOE环境建设，系统梳理依赖拓扑。
`;
  const r2 = parseResumeText(t);
  const blocks2 = r2.blocks.filter((b) => b.kind === 'internship_experience');
  expect(blocks2.length === 1, `一段实习不应被拆散，实际 ${blocks2.length} 段`);
  const f2 = new Map(blocks2[0]?.fields.map((f) => [f.role, f.value]) ?? []);
  expect(f2.get('company') === '字节跳动', `实习公司=字节跳动，实际 ${f2.get('company')}`);
  expect((f2.get('role') ?? '').includes('测试开发实习生'), `实习岗位含测试开发实习生，实际 ${f2.get('role')}`);
  expect((f2.get('period') ?? '').includes('2026.05'), `实习时间段含2026.05，实际 ${f2.get('period')}`);
  const desc2 = f2.get('description') ?? '';
  expect(desc2.includes('参与新功能'), '描述含首段内容');
  expect(desc2.includes('TCC自动化升级流水线'), '描述含 TCC 成就段');
  expect(desc2.includes('压缩至7天'), '描述含折行续段内容（天压缩至7天）');
  expect(desc2.includes('AI测试找回策略优化'), '描述含 AI 成就段');
  expect(desc2.includes('BOE环境建设'), '描述含 BOE 成就段');
  expect(!desc2.startsWith('质量团队'), '团队等剩余信息不应排在描述开头之外（不把成就段抽成公司）');
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (unmatched.length) console.log('unmatched 示例:', unmatched.slice(0, 5));
if (fail > 0) {
  console.log('—— 全部条目 ——');
  for (const e of entries) console.log(`  ${e.fieldKey}: ${e.value.slice(0, 60)}`);
  process.exit(1);
}
console.log('简历解析器测试全部通过 ✅');
