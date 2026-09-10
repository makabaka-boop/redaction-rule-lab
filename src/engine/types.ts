/**
 * 引擎公共类型。所有区间均为字符下标 [start, end)，基于原文（UTF-16 码元）。
 */

/** 解析并通过校验、可直接参与匹配的规则。 */
export interface RedactionRule {
  /** 规则编号，如 "R1"。未显式提供时按顺序自动生成。 */
  id: string;
  /** 规则名称，必填。 */
  name: string;
  /** 正则源文本（不含分隔符）。 */
  pattern: string;
  /** 用户声明的附加标志，仅允许 i/m/s/u 的子集；引擎始终附加 g。 */
  flags: string;
  /** 优先级，数值越大越优先。 */
  priority: number;
  /** 替换模板，支持 $$、$&、$1-$99、$<name>。 */
  template: string;
  /** 是否为导出前必检项：脱敏结果中不得再出现该规则的命中。 */
  mustCheck: boolean;
  /** 是否为高风险人工复核项：该规则的每个保留区间须人工确认后才允许导出；缺省 false。 */
  reviewRequired: boolean;
  /** 规则在规则列表中的顺序（0 起），用于同优先级裁决。 */
  order: number;
  /** 规则文件中的 enabled 初值；界面启停以此为基础。 */
  enabledByDefault: boolean;
  /**
   * 例外值清单（缺省为空数组）：原文命中文本与其中任一项【全量精确】相等时，
   * 该命中在模板展开后、重叠裁决前被剔除，不遮蔽、不进入清单与导出。
   * 比较是否忽略大小写跟随该规则的 i 标志。
   */
  excludedValues: string[];
  /** 编译后的正则（恒含 g 标志）。 */
  regex: RegExp;
}

/** 结构化错误：始终尽量携带规则编号或字符位置。 */
export interface EngineError {
  code:
    | 'RULES_JSON_INVALID'
    | 'RULES_SHAPE_INVALID'
    | 'RULE_FIELD_INVALID'
    | 'REGEX_INVALID'
    | 'FLAGS_INVALID'
    | 'TEMPLATE_INVALID'
    | 'ZERO_LENGTH_MATCH'
    | 'MUST_CHECK_RESIDUAL'
    | 'ENCODING_UNSUPPORTED'
    | 'DECODE_FAILED'
    | 'NO_RULES_ENABLED'
    | 'SOURCE_EMPTY';
  message: string;
  /** 相关规则编号（若有）。 */
  ruleId?: string;
  /** 规则在列表中的序号（0 起，若有）。 */
  ruleIndex?: number;
  /** 相关字符/字节位置（若有）。 */
  position?: number;
  /** 区间结束位置（若错误涉及一段区间）。 */
  end?: number;
  /** 相关文件名（文件读取/解码错误）。 */
  file?: string;
  /** 输入来源标记：界面据此按来源清理文件错误（原文面板 / 规则面板）。 */
  scope?: 'source' | 'rules';
}

/** 单条命中候选（替换前）。 */
export interface Candidate {
  ruleId: string;
  ruleName: string;
  ruleIndex: number;
  priority: number;
  mustCheck: boolean;
  reviewRequired: boolean;
  start: number;
  end: number;
  /** 命中的原文片段。 */
  matched: string;
  /** 模板展开后的替换文本。 */
  replacement: string;
}

/** 裁决后被保留的区间。 */
export interface AcceptedInterval extends Candidate {
  /** 裁决说明（为何保留）。 */
  reason: string;
  /** 被本区间击败的竞争者。 */
  defeated: DefeatedRef[];
}

/** 被否决的候选及其原因。 */
export interface RejectedCandidate extends Candidate {
  reason: string;
  winnerRuleId: string;
  winnerStart: number;
  winnerEnd: number;
}

/**
 * 被规则例外值剔除的命中：原文命中文本与例外值全量精确相等，
 * 在裁决前移除，不遮蔽、不进入 AcceptedInterval、人工确认清单与导出文件。
 */
export interface ExcludedCandidate {
  ruleId: string;
  ruleName: string;
  ruleIndex: number;
  start: number;
  end: number;
  /** 命中的原文片段（与某个例外值全量精确相等）。 */
  matched: string;
}

export interface DefeatedRef {
  ruleId: string;
  ruleName: string;
  start: number;
  end: number;
  reason: string;
}

/** 输出文本的一段：原文片段或遮蔽块。 */
export interface Segment {
  kind: 'plain' | 'masked';
  text: string;
  /** 遮蔽块对应 AcceptedInterval 在结果数组中的下标；plain 段为 -1。 */
  intervalIndex: number;
}

/** 人工复核状态：待确认 / 已确认。仅 reviewRequired 条目存在待确认态。 */
export type ReviewStatus = 'pending' | 'confirmed';

/** 审阅清单条目：与脱敏文本逐项对应。 */
export interface ChecklistEntry {
  index: number;
  ruleId: string;
  ruleName: string;
  priority: number;
  mustCheck: boolean;
  /** 该区间是否需要人工复核（来自命中规则的 reviewRequired）。 */
  reviewRequired: boolean;
  /** 人工确认状态；管线初始产出恒为 pending，已确认状态由 store 对账后写回。 */
  reviewStatus: ReviewStatus;
  /** 原文区间与内容。 */
  sourceStart: number;
  sourceEnd: number;
  sourceText: string;
  /** 脱敏文本中的区间与内容。 */
  outputStart: number;
  outputEnd: number;
  outputText: string;
  replacement: string;
  arbitration: string;
}

/** 管线成功结果。 */
export interface RunOk {
  ok: true;
  source: string;
  output: string;
  segments: Segment[];
  accepted: AcceptedInterval[];
  rejected: RejectedCandidate[];
  /** 被规则例外值剔除的命中（按原文顺序），供规则面板与详情区核对。 */
  excluded: ExcludedCandidate[];
  checklist: ChecklistEntry[];
  /** 本次参与计算的规则（仅启用的）。 */
  activeRules: RedactionRule[];
  /** 本次结果中要求人工复核的区间数。 */
  reviewRequiredCount: number;
  /** 其中已被人工确认的区间数（管线产出时恒为 0，store 对账后写回）。 */
  reviewConfirmedCount: number;
  /** 尚待人工确认的区间数。 */
  reviewPendingCount: number;
}

/** 管线失败结果：不携带任何部分产物，调用方必须保留上一份有效结果。 */
export interface RunFail {
  ok: false;
  errors: EngineError[];
}

export type RunResult = RunOk | RunFail;

export type ParseRulesResult =
  | { ok: true; rules: RedactionRule[] }
  | { ok: false; errors: EngineError[] };

export type DecodeResult =
  | { ok: true; text: string }
  | { ok: false; error: EngineError };
