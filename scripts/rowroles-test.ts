/**
 * M4 行角色归属测试：npx tsx scripts/rowroles-test.ts
 */
import {
  kindOfHeading,
  rowRoleOfText,
  splitPeriod,
} from '../src/shared/rowRoles';

let pass = 0;
let fail = 0;
const check = (cond: boolean, msg: string): void => {
  if (cond) pass++;
  else {
    fail++;
    console.log('  ✗ ' + msg);
  }
};

check(rowRoleOfText('开始时间') === 'start', '开始时间 → start');
check(rowRoleOfText('开始时间*') === 'start', '带星号开始时间 → start');
check(rowRoleOfText('结束时间') === 'end', '结束时间 → end');
check(rowRoleOfText('起止时间') === 'period', '起止时间 → period');
check(rowRoleOfText('企业名称') === 'company', '企业名称 → company');
check(rowRoleOfText('实习单位') === 'company', '实习单位 → company');
check(rowRoleOfText('职位名称') === 'role', '职位名称 → role');
check(rowRoleOfText('实习岗位') === 'role', '实习岗位 → role');
check(rowRoleOfText('项目名称') === 'name', '项目名称 → name');
check(rowRoleOfText('项目职责') === 'responsibility', '项目职责 → responsibility');
check(rowRoleOfText('工作描述') === 'description', '工作描述 → description');
check(rowRoleOfText('项目描述') === 'description', '项目描述 → description');
check(rowRoleOfText('学校') === 'school', '学校 → school');
check(rowRoleOfText('专业') === 'major', '专业 → major');
check(rowRoleOfText('最高学历') === 'degree', '最高学历 → degree');
check(rowRoleOfText('部门') === 'department', '部门 → department');
check(rowRoleOfText('无意义文本xyz') === null, '无关文本 → null');

check(kindOfHeading('实习经历') === 'internship_experience', '实习经历区块');
check(kindOfHeading('项目经验') === 'project_experience', '项目经验区块');
check(kindOfHeading('教育经历') === 'edu_experience', '教育经历区块');
check(kindOfHeading('工作经历') === 'work_experience', '工作经历区块');
check(kindOfHeading('获奖情况') === 'awards', '获奖区块');
check(kindOfHeading('自我介绍') === null, '非经历区块 → null');

{
  const s = splitPeriod('2021.07-2021.10');
  check(s.start === '2021.07' && s.end === '2021.10', `拆时间段 ${s.start}-${s.end}`);
  const s2 = splitPeriod('2020.09 至 2022.06');
  check(s2.start === '2020.09' && s2.end === '2022.06', `拆时间段(至) ${s2.start}-${s2.end}`);
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail > 0 ? 1 : 0);
