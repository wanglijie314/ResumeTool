# 项目状态（压缩版 · 会话接续用）

> 目的：浓缩长期对话上下文。新会话/自动轮次先读本文件即可接上进度，不用翻长对话。

## 产品一句话
招聘网站简历表单自动填写 Chrome/Edge 扩展（Manifest V3，纯本地）。识别字段→按默认副本自动填；未识别字段走“新增自定义字段+教学”；多副本信息管理 + 本地简历解析 + 经历多行组合填写。

## 技术栈/构建要点（重要，踩过的坑）
- TS + Vite 8 + CRXJS 2.7；额外依赖：fflate(docx)、pdfjs-dist(v6)、vite-plugin-static-copy(pdf worker)、tsx(测试)。
- **SW loader 错位 bug**：CRXJS+Vite8 会把 service-worker-loader 指向内容脚本 chunk → SW 里顶层 `document` 崩溃。已用 `scripts/fix-sw-loader.mjs` 后置脚本修正（已并入 `npm run build`），markers: `unknown-message`+`GET_SETTINGS`。
- vite.config 已关 `modulePreload`（扩展页 cross-world preload 告警）。
- pdfjs worker 由 static-copy 平铺到 `dist/assets/pdf.worker.mjs`（rename stripBase），代码里 workerSrc 指向 chrome.runtime.getURL('assets/pdf.worker.mjs')。
- 扩展重载(↻)后旧标签页脚本失效属正常；动态补注入易受“磁盘产物 vs 已加载 manifest 版本”不一致影响 → 报错提示让用户 ↻+F5（popup 已区分 stale-extension/inject-failed/no-response）。
- 本会话沙箱无法启动 Chrome/headless → 浏览器内验证全靠用户手测；冒烟自动化只能用 Node/tsx 单测。

## 里程碑
- M0 骨架 ✅（MV3/vite/crxjs/图标/manifest 移 src）
- M1 扫描与识别 ✅（scanner 标签多来源+kind/widget 判定；dictionary+置信度；识别面板可拖动可关闭；SNP 表单快照/填充分消息 GET_SNAPSHOT/FILL/FORCE_SCAN/PROBE/TOAST）
- M2 多副本+弹窗填写 ✅（ProfileCopy/entries+blocks+custom；popup 扫描填写/副本管理；options 编辑器+简历导入预览可编辑；运行日志 logger 环形 20 会话/1 天）
- M3 教学闭环 ✅（WordMapping 全局词表 taught/alias；教学浮层默认“未识别→新增自定义字段(建议名来自真标签, placeholderOnly 警告)”，次级归类/本站忽略/跳过；分类器词表最高优先级；labels vs placeholder 分级；自定义字段 custom: 链路；别名/忽略管理）
- M4 经历多行组合驱动 ✅ 代码级（rowRoles 行角色别名、rowFill DOM 行/组探测+增行按钮+heading 归属；FILL_ROWS 按 blocks 逐段增行填写、单组合只填第一段+剩余提醒；普通 FILL 排除行内格；popup「按段填经历」+结果提示；整段 textarea 逻辑保留）——**真实站点形态尚未广泛验证**
- 简历解析细化 ✅（固定口径：实习=公司/岗位/时间段/描述；项目=名称/职责/描述；多段各自成块保序；职责/描述拆分；时间统一 xxxx.xx(.xx)；切段规则：含中文冒号行不切段等；整段粗字段正文不再带头部标题；结构化块可在副本/导入预览直接编辑，保存时自动重算整段文本）
- 下拉模糊最佳匹配 ✅（shared/textMatch 相似度 0.6 门槛）；日期组件模拟 hover/click 序列+可直接写兜底；弹窗均有关闭按钮（拖拽不吞按钮点击）
- M5 AI 字段识别底座 ✅（建议级口径：AI 永不自动作答，接受才生效）
  - skill `page-match`：未识别控件清单 → 字段键 map/new/skip，system 含键枚举白名单，严格解析（越界/非法键丢弃）
  - 通道 `shared/aiProvider`：/chat/completions + response_format=json_object（智谱默认端点、APIKey/模型可配、超时/网络/HTTP/解析错误分类）
  - `shared/aiSuggestions` 表 pending/accepted/ignored；popup「AI 识别 N 个…」建议列表，✓接受=upsertWord(taught)+自动重扫，✗忽略=仅标记；接受前零写入词表
  - options 新增「AI 设置」配置；manifest 增加 bigmodel.cn 域名权限；仅发控件 标签/提示词/形态，不含填写值
- M6 简历解析 AI 兜底 ✅（skill `resume-extract`）
  - 规则解析遗留行（unmatched）→ 自动 AI 补全：可用键=内置标量（剔除 6 类整段经历键与照片），严格校验/按值类型截断/同键留高 conf
  - 合并决策：规则已有键仅 conf≥0.9 才覆盖，否则丢弃；结果全部为可编辑草稿，另存/合并才落副本
  - 触发口径：AI 设置填了 Key 且存在遗漏行/规则零结果 → 自动调用（发送遗漏片段+简历上下文≤2 万字给模型商，不弹确认）；无 Key 完全退化为纯规则解析，不发送任何内容；任何失败退回规则结果
  - options 顶部独立「AI 设置」页签（原“设置”改造）：状态徽标 启用/未启用 + 数据外发说明 + 保存/测试连接

## 目录要点
- src/shared：taxonomy(内置字段)、keys(custom:)、profile(副本CRUD)、learning(词表/忽略)、storage、logger、resumeParser、resumeFile、rowRoles、blocks(整段<->结构化)、textMatch、nameHint、types、aiProvider、aiSuggestions
- src/skills：page-match（页面字段识别建议）、resume-extract（简历解析 AI 补全）
- src/content：scanner、classifier、dictionary、filler、widgets(日期/下拉)、teachOverlay、rowFill、panel、drag、index(主循环+消息)
- src/popup（扫描填写/教学入口/按段填经历/AI 识别建议）、src/options（副本编辑器+结构化经历+自定义字段+词表/日志/简历导入/AI 设置）、src/background(精简 SW+AI_ANALYZE/AI_TEST)
- scripts/*-test.ts（含 ai-test 11 项、resume-ai-test 26 项）；pages/demo.html（含自定义下拉/日历/多行组合两场景）；vite.config、manifest(src)、scripts/fix-sw-loader.mjs、serve.mjs

## 测试命令（Node 直跑）
`npm run typecheck` / `test:classify` / `test:keys` / `test:rows` / `test:ai` / `test:resume` / `build`（build 内含 fix-sw-loader）

## 待办/边界（下一步候选）
- M4 真实站点适配：需要用户提供具体站点的行组合 DOM 结构做收敛；探测失败有明确提示、绝不乱填。
- 地域下拉驱动（方案已确认未开工）：shared/region 省市拆分+候选表、widgets 可搜索下拉+cascade、region-hints 站点记忆+失败日志。
- 可加：OCR(扫描版PDF)、简历 AI 补全暂限内置标量字段（“AI 新建自定义字段”落地导入预览为后续）、自定义字段参与别名管理更顺滑、教学命中计数递增、站点级词表开关。
- 隐私：默认全本地无网络；仅当「AI 设置」填了 Key 才外发——页面字段识别发 控件标签/提示词/形态，简历导入发 遗漏片段+简历上下文(≤2 万字) 给该模型服务商；不填不发。日志自动清理（20 会话/1 天/200 事件上限）。

## 用户偏好/交互口径（近期明确）
- 字段“未识别”→ 按“需要新增字段”处理（先新增，归已有是次级）。
- 实习/项目固定字段口径如上；多段按顺序；页面单组合同只填第一段并提醒。
- 日期规范 `xxxx.xx.xx`；弹窗都要能关、浮层可拖动。
- 数据/字段名只读前端 DOM，绝不读后端 JSON。
