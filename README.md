# 简历一键填（Jianli AutoFill）

**招聘网站简历表单的自动填写助手**——Chrome/Edge（Manifest V3）扩展，全程本地处理、不上传任何数据。

- 扫描公司自建招聘站 / BOSS / 智联 / 校招网申等页面的表单字段（文本、下拉、日期、自定义控件），识别后按默认副本自动填写，只填空项、不覆盖、敏感字段可控；
- 遇到**没见过的字段**：教学浮层引导**新增自定义字段并填值**，或归到已有字段/本站忽略——教一次**全局记住**，下次自动识别；
- **信息副本**：多份简历信息可分别维护并设默认；结构化“经历段”（实习=时间段/公司/岗位/描述；项目=名称/职责/描述…）支持**页面多行组合按顺序逐段填写**，行不够时明确提醒“剩余未填”，绝不串填；
- 本地解析 `.pdf/.docx/.txt/.md` 简历 → 结构化字段预览、可编辑后再建副本或合并；
- 内置运行日志（本地环形存储、自动清理）、学习词表与别名管理、自定义字段等，帮助持续收敛识别规则。

当前进度：M0 骨架 ✅ · M1 扫描识别 ✅ · M2 多副本+弹窗填写 ✅ · M3 教学/自定义字段/词表 ✅ · M4 经历多行填写驱动 ✅（真实站点形态仍待广泛验证） · M5 AI 字段识别（建议级）✅ · M6 简历解析 AI 补全 ✅

> 项目背景 / 遇到的问题 / 解决方案 / 最终结果 的完整叙述版见 `docs/PLUGIN_OVERVIEW.md`；会话接续信息见 `docs/PROJECT_STATE.md`。

## AI 增强（可选，自带 Key）

在管理页顶部「AI 设置」页签填接口地址 / 模型名 / API Key 即可开启，两处生效：

- **页面字段识别**：弹窗对未识别字段给出 AI 建议（只发控件标签/提示词/形态，不含你填的值）；**接受**后才写入全局词表并自动重扫；
- **简历解析补全**：上传简历时，规则解析遗漏/疑似错误的部分自动交给 AI 补齐，结果以可编辑草稿进入预览。

每次真实模型请求都会记入「运行日志」（用途/模型/端点/耗时/错误码），可据此确认是否真的走了 AI。**不填 Key 则完全不调用、不发送任何数据**，全部使用内置算法；清空 Key 保存即关闭。

## 使用（M2 新增）

1. 点工具栏图标弹出操作面板：
   - **扫描并填写**：连接当前页 → 按"默认副本"列出识别出的字段；副本里有的将直接填写（只填空项、不覆盖）；
     副本里没有的字段显示橙色输入框，可**就地补充** → 自动保存进默认副本（不影响其它副本）；
     副本有、但本页没有的字段提示"不填写"。
   - **信息副本**：新建多份副本（可复制默认副本为起点）、设默认、重命名、删除；详细内容编辑在完整管理页。
2. 完整管理页（popup → 完整管理 / chrome://extensions → 详情 → 扩展程序选项）：
   「我的档案」多副本 + 条目编辑器；「运行日志」查看启动/扫描记录、导出 .txt、清空。
3. **上传简历解析**（管理页「我的档案」→ 上传简历解析…）：本地解析 .pdf/.docx/.txt/.md，
   自动抽取 姓名/联系方式/教育经历/项目经历 等条目 → 「另存为新副本」或「合并到当前副本」。
   解析纯本地（pdfjs + docx 解包），不上传；未能归类的行会提示，可导入后人工补充。
4. 数据与日志：全部存本机 chrome.storage.local；日志保留最近 20 会话、超 1 天自动清理。

## 快速开始（开发版加载）

```bash
npm install        # 依赖（本机若限制 npm 缓存目录，可加 --cache .npm-cache）
npm run build      # 产物输出到 dist/
```

然后：

1. 打开 `chrome://extensions/`，右上角开启「开发者模式」；
2. 点「加载已解压的扩展程序」，选择本目录的 `dist` 文件夹；
3. 打开演示页 `pages/demo.html`（本地文件需先在扩展详情里开启「允许访问文件网址」，
   或任选一个真实招聘网站的表单页）。

预期效果：页面右上角出现「简历识别」面板，按分组列出识别出的字段与置信度；
点击条目可定位页面字段；「重扫」手动刷新。

## 开发命令

| 命令 | 作用 |
|---|---|
| `npm run build` | 构建到 `dist/`（含 SW loader 修正后置脚本） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test:classify` | 分类器/词典逻辑测试（62 断言） |
| `npm run test:keys` | 自定义键与文本相似度测试 |
| `npm run test:rows` | 经历行角色探测测试 |
| `npm run test:resume` | 简历解析 + DOCX 抽取测试 |
| `npm run test:ai` | AI 契约解析测试（page-match 11 项 + resume-extract 26 项） |
| `npm run check` | 类型检查 + 全部逻辑测试 + 构建 |
| `npm run dev` | Vite dev（CRXJS 热更新，需配合 chrome 加载后自动重载） |

调试：在目标页面控制台执行 `window.__jianliAutofillDebug`，可 `rescan()` / 查看原始候选 `raw()`。

## 目录结构

```
manifest.json           MV3 清单
vite.config.ts          CRXJS 构建配置
src/shared/             taxonomy 字段体系、keys(custom:)、profile 副本、learning 词表、storage、
                        logger、resumeParser/resumeFile、blocks 结构化经历、rowRoles、textMatch、
                        aiProvider(AI 通道) · aiSuggestions(建议表)
src/skills/             page-match（页面字段识别建议）· resume-extract（简历解析 AI 补全）
src/content/            scanner 扫描器 · dictionary 内置词典 · classifier 分类器 · filler 填写 ·
                        widgets 自定义下拉/日历 · teachOverlay 教学浮层 · rowFill 按段填经历 ·
                        panel 识别面板 · index 主循环（MutationObserver 跟随 SPA）
src/background/         service worker（默认存储、消息通道、AI_ANALYZE/AI_TEST）
src/popup/              工具栏弹窗（扫描并填写 / 信息副本 / AI 识别 / 按段填经历）
src/options/            完整管理页（我的档案 / 学习规则 / 运行日志 / AI 设置 / 字段体系 / 关于与隐私）
docs/                   PROJECT_STATE.md 会话接续 · PLUGIN_OVERVIEW.md 项目介绍 · 简历解析示例
pages/demo.html         本地演示页（含自定义下拉/日历/多行组合场景）
public/icons/           扩展图标
```

## 识别策略（M1 已实现）

- 稳定高置信：内置词典按「归一化标签文本」匹配（如 身份证→id_card、英语六级→cet6_score、项目经历→project_experience）；
- 多来源线索：label[for] / aria-labelledby / 包裹 label / 相邻小文本行 / placeholder / name / id；
- 单选组：按 name 分组收集选项文本，支持“无标签按选项猜性别/工作性质”的兜底；
- 屏蔽噪音：验证码、登录、搜索类控件直接忽略；
- 学习规则：本地已存规则优先于内置词典（M3 开始写入）；
- 面板跟随：MutationObserver 监听 DOM/样式变化自动重扫，SPA 下一步新增字段会实时出现。

## 已知边界（后续）

- **M4 真实站点适配**：经历行组合的 DOM 形态需按具体站点收敛；探测失败会明确提示"剩余未填"，绝不乱填；
- **地域省市下拉通用驱动**：方案已定（省市拆分 + 可搜索下拉 + 级联），待开发；
- **OCR**：扫描版 PDF 暂不支持，需 OCR 或手工填写；
- **简历 AI 补全范围**：目前只补内置标量字段，"AI 新建自定义字段并落地导入预览"待做；
- 登录墙、验证码（非表单验证码）不在工具自动化范围内，遇到由用户人工处理。

## 隐私

所有数据只存本机 `chrome.storage.local`，默认不上传。仅在管理页「AI 设置」填写了 API Key 时才外发：页面字段识别发送**控件标签/提示词/形态**（不含填写值），简历补全发送**简历片段与上下文（≤2 万字）**给该模型服务商；不填 Key 则不发送任何内容。高敏感字段（身份证等）填写前需确认。
