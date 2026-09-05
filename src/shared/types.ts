/**
 * 跨模块共享的类型定义。
 * 注意：FieldCandidate 只保存"可序列化描述"，真实的 DOM 元素引用由
 * content 侧 scanner 的实例登记表（Map id -> Element）单独维护，
 * 这样快照可以安全地跨消息传递，也便于后续做快照差异比对。
 */
import type { FieldGroupKey, FieldKey } from './taxonomy';

/** 置信度：0..1 */
export type Confidence = number;

/** 候选字段的"标签文本"来源，用于诊断与学习规则 */
export type LabelHow =
  | 'aria-labelledby'
  | 'label-for'
  | 'wrapping-label'
  | 'aria-label'
  | 'radio-group'
  | 'preceding'
  | 'placeholder'
  | 'attr';

export interface LabelSource {
  text: string;
  how: LabelHow;
}

export interface FieldCandidate {
  /** 扫描会话内稳定 id */
  id: string;
  tag: 'input' | 'textarea' | 'select';
  /** input[type] 小写；textarea/select 为空串 */
  inputType: string;
  /** 填写形态（text/select/widget…），决定填写策略 */
  kind: ControlKind;
  widget?: WidgetHint;
  labelText: string;
  labelSources: LabelSource[];
  placeholder: string;
  name: string;
  idAttr: string;
  ariaLabel: string;
  /** radio 组 / select 的选项文本 */
  optionTexts: string[];
  required: boolean;
  readonly: boolean;
  disabled: boolean;
  /** 归一化后的可搜索文本（标签+占位符+name+id） */
  haystack: string;
}

export type MatchBasis = 'learned-rule' | 'dictionary' | 'none';

export interface Classification {
  /** 归一的字段键：内置 taxonomy key 或用户自定义字段 key（custom:…） */
  fieldKey: string | null;
  fieldGroup: FieldGroupKey | null;
  confidence: Confidence;
  basis: MatchBasis;
  /** 命中原因/说明，用于面板与排查 */
  reasons: string[];
}

export interface ClassifiedField {
  candidate: FieldCandidate;
  result: Classification;
}

/**
 * 全局用户词表（M3）：把"页面文本/用户叫法"教给扩展 → 归一到标准字段键。
 * 来源二选一：
 *  - taught：在教学浮层里把某个未识别控件归类时自动生成；
 *  - alias ：用户在别名管理里手动登记的同义词（如“本科院校”→“毕业院校/院校”类）。
 * 词表【全局生效】（跨站点），分类器把它置于最高优先级。
 */
export interface WordMapping {
  id: string;
  /** 归一化后的文本（页面标签/占位符，或用户填写的别名），词表匹配键 */
  labelKey: string;
  /** 目标字段键：内置 taxonomy key 或自定义字段 key（custom:…） */
  fieldKey: string;
  source: 'taught' | 'alias';
  createdAt: number;
  updatedAt: number;
  hits: number;
}

export interface SiteIgnore {
  id: string;
  domain: string;
  labelKey: string;
  createdAt: number;
}

/** 简历信息档案条目（M2）：单条字段值 */
export interface ProfileEntry {
  fieldKey: FieldKey;
  /** 值；多值经历类字段当前用多行文本表示（每行一段） */
  value: string;
  updatedAt: number;
  source: 'user' | 'learned';
}

/** 经历块内子字段的角色（实例级：一段实习/一个项目等） */
export type ExperienceRole =
  | 'name'
  | 'company'
  | 'role'
  | 'department'
  | 'responsibility'
  | 'period'
  | 'school'
  | 'major'
  | 'degree'
  | 'description'
  | 'other';

export interface ExperienceBlockField {
  role: ExperienceRole;
  value: string;
}

/** 一段结构化经历：kind 指明所属大区（实习/项目/教育…），fields 为细分子字段 */
export interface ExperienceBlock {
  id: string;
  kind: FieldKey;
  /** 该段原文首行（保留现场信息） */
  heading?: string;
  fields: ExperienceBlockField[];
  updatedAt: number;
}

/** 自定义字段：用户新建的名称+值（如“居住城市”→“北京”），名字即身份 */
export interface CustomFieldValue {
  name: string;
  value: string;
  updatedAt: number;
}

/**
 * 信息副本（ProfileCopy）：一份完整的简历信息集合。
 * 可创建多份（如校招/社招/不同岗位），其中 isDefault 的一份用于页面填写；
 * 各副本互相独立，补充的信息只写入当前操作的副本。
 * entries 保留"粗粒度"内置字段（含经历整段），blocks 保存解析出的"结构化经历块"，
 * custom 保存用户自定义字段。
 */
export interface ProfileCopy {
  id: string;
  name: string;
  isDefault: boolean;
  entries: ProfileEntry[];
  blocks: ExperienceBlock[];
  custom: CustomFieldValue[];
  createdAt: number;
  updatedAt: number;
}

/** —— 页面快照（popup ↔ content 通信）—— */

/** 控件的可填写形态：决定填写策略 */
export type ControlKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'native-date'
  | 'widget'
  | 'radio'
  | 'checkbox'
  | 'other';

/** 自定义控件（widget）的猜测类型 */
export type WidgetHint = 'date' | 'choice';

export interface SnapshotField {
  id: string;
  tag: 'input' | 'textarea' | 'select';
  inputType: string;
  kind: ControlKind;
  /** kind==='widget' 时，按结构线索猜测的下拉/日期类型 */
  widget?: WidgetHint;
  labelText: string;
  placeholder: string;
  name: string;
  idAttr: string;
  optionTexts: string[];
  required: boolean;
  readonly: boolean;
  disabled: boolean;
  /** 识别结果；null = 未识别。值可为内置 key 或自定义字段 key（custom:…） */
  fieldKey: string | null;
  confidence: number;
  /** 验证码/登录/搜索等被忽略的控件 */
  ignored: boolean;
  reasons: string[];
}

export interface SnapshotData {
  fields: SnapshotField[];
  controls: number;
  recognized: number;
  unknown: number;
  ignored: number;
}

/** 弹窗请求填写的目标（字段键可为内置或自定义 key） */
export interface FillTarget {
  fieldKey: string;
  value: string;
}

export interface FillFieldReport {
  fieldKey: string;
  zh: string;
  /** 页面上命中的控件数 */
  matched: number;
  /** 实际成功填写数 */
  filled: number;
  notices: string[];
}

export interface FillReport {
  targets: number;
  totalMatched: number;
  totalFilled: number;
  fields: FillFieldReport[];
}

/** —— 运行日志（本地环形记录，便于排查启动/扫描问题）—— */

export interface LogEvent {
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  data?: unknown;
}

export interface LogSession {
  /** 形如 content-1725000000000 */
  id: string;
  source: 'content' | 'background' | 'options';
  startedAt: number;
  endAt?: number;
  url?: string;
  title?: string;
  events: LogEvent[];
}
