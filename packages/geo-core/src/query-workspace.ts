// ============================================================================
// M8E — Query Workspace 纯函数（deterministic，0 LLM / 0 network）
// ============================================================================
// 包含：
//   1) 文本归一化（NFKC + case-fold + whitespace collapse）—— 供 dedup 与检测
//   2) Target Contamination Detector：queryText 是否命中 canonical / alias
//      （CLEAN / TARGET_MENTIONED / POSSIBLE_TARGET_MENTION + matchedAlias）
//   3) Discovery Query Guard：DISCOVERY 含目标 → 拒绝，或改 BRANDED_SANITY
//   4) Deterministic Query Builder：模板组合（category/scenario/intent/audience/
//      modifier），去重、稳定排序、preview cap、Target 泄漏标记
// 原则：不调用 LLM、不发网络、输入不被修改、同输入同输出。

export type TargetContaminationStatus =
  | 'CLEAN'
  | 'TARGET_MENTIONED'
  | 'POSSIBLE_TARGET_MENTION';

export interface TargetIdentity {
  canonicalName: string;
  aliases?: string[];
}

export interface ContaminationResult {
  status: TargetContaminationStatus;
  matchedAlias: string | null;
}

export type QuerySemanticType = 'DISCOVERY' | 'BRANDED_SANITY' | 'CUSTOM';
export const QUERY_SEMANTIC_TYPES: QuerySemanticType[] = ['DISCOVERY', 'BRANDED_SANITY', 'CUSTOM'];

/**
 * NFKC + lowercase + separator 折叠（query 去重/匹配用；保留原文用于展示）。
 * 空格 / hyphen / underscore 被视为“品牌 token separator”等价物：
 *   Nova Flow / Nova-Flow / Nova_Flow / nova flow 归一为同 token 序列，
 * 但仍保留 token boundary —— 绝不把 'workflow' 拆成 'work flow'，杜绝 substring 误报。
 */
export function normalizeQueryText(text: string): string {
  return text.normalize('NFKC').trim().replace(/[\s_-]+/gu, ' ').toLowerCase();
}

/**
 * 目标污染检测（确定性）。
 * 规则：
 *   - 先 NFKC/case 归一 target canonical + aliases 与 query
 *   - 边界判断：拉丁别名要求词边界（preceded/followed by 非 latin 或边界）；
 *     中文/无空格语言直接子串即可（query 中“ProjectMentor”作为词出现即污染）。
 *   - URL 内命中不算（用户把目标写进示例链接不构成 query 泄漏）——v1 保守：仍判
 *     POSSIBLE_TARGET_MENTION，交由 UI 提示。
 *   - longest alias 优先（“Project Mentor” vs “ProjectMentor AI” 命中更长的）。
 */
export function detectTargetContamination(queryText: string, target: TargetIdentity): ContaminationResult {
  const normalizedQuery = normalizeQueryText(queryText);
  if (!normalizedQuery) return { status: 'CLEAN', matchedAlias: null };

  const urlStripped = normalizedQuery.replace(/https?:\/\/[^\s]+/gu, '');
  const urlHadMatch = urlStripped !== normalizedQuery;

  // token 化：normalize 已将 空格/hyphen/underscore 统一折叠为空格，
  // 多词候选按 token 精确序列比对（保留 token boundary），单词候选走 word-boundary 子串。
  const queryTokens = normalizedQuery.split(/\s+/u).filter(Boolean);
  const urlTokens = urlStripped.split(/\s+/u).filter(Boolean);
  const tokensOf = (text: string) => text.split(/\s+/u).filter(Boolean);
  const hasTokenSequence = (haystackTokens: string[], needleTokens: string[]) => {
    if (needleTokens.length === 0 || haystackTokens.length < needleTokens.length) return false;
    for (let i = 0; i + needleTokens.length <= haystackTokens.length; i++) {
      let ok = true;
      for (let j = 0; j < needleTokens.length; j++) {
        if (haystackTokens[i + j] !== needleTokens[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  };
  const isLatinText = (text: string) => /^[\p{Script=Latin}\p{N}_\s]+$/u.test(text);

  const candidates = [
    ...(target.aliases ?? []).map(alias => ({ alias, text: normalizeQueryText(alias) })),
    { alias: target.canonicalName, text: normalizeQueryText(target.canonicalName) },
  ]
    .filter(c => c.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length); // longest first（确定性）

  for (const candidate of candidates) {
    const cTokens = tokensOf(candidate.text);
    const singleWord = cTokens.length === 1;

    if (singleWord) {
      // 单 token 拉丁词：strict word-boundary，杜绝 substring 误报（"workflow" 不命中 "Flow"）
      const isLatinWord = /^[\p{Script=Latin}\p{N}_]+$/u.test(candidate.text);
      const pattern = isLatinWord
        ? new RegExp(`(^|[^\\p{Script=Latin}\\p{N}_])${candidate.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{Script=Latin}\\p{N}_]|$)`, 'u')
        : null;
      if (pattern) {
        if (pattern.test(urlStripped)) {
          return { status: 'TARGET_MENTIONED', matchedAlias: candidate.alias };
        }
        if (urlHadMatch && pattern.test(normalizedQuery)) {
          // 仅在 URL 内出现（或无法判断 URL 内外时）→ POSSIBLE
          return { status: 'POSSIBLE_TARGET_MENTION', matchedAlias: candidate.alias };
        }
      } else {
        // 中文/无空格语言：直接子串；仍做基础归一。若只在 URL 段落内算 POSSIBLE。
        if (urlStripped.includes(candidate.text)) {
          return { status: 'TARGET_MENTIONED', matchedAlias: candidate.alias };
        }
        if (urlHadMatch && normalizedQuery.includes(candidate.text)) {
          return { status: 'POSSIBLE_TARGET_MENTION', matchedAlias: candidate.alias };
        }
      }
    } else {
      // 多 token 候选：token 精确序列匹配（Latin 可靠分词；Nova Flow / Nova-Flow / Nova_Flow 变体等价）
      if (hasTokenSequence(urlTokens, cTokens)) {
        return { status: 'TARGET_MENTIONED', matchedAlias: candidate.alias };
      }
      if (urlHadMatch && hasTokenSequence(queryTokens, cTokens)) {
        return { status: 'POSSIBLE_TARGET_MENTION', matchedAlias: candidate.alias };
      }
      // 含 CJK 的多词候选无法可靠分词：仅当整体非纯 Latin 时回退子串，避免拉丁 substring 误报
      if (!isLatinText(candidate.text)) {
        if (urlStripped.includes(candidate.text)) {
          return { status: 'TARGET_MENTIONED', matchedAlias: candidate.alias };
        }
        if (urlHadMatch && normalizedQuery.includes(candidate.text)) {
          return { status: 'POSSIBLE_TARGET_MENTION', matchedAlias: candidate.alias };
        }
      }
    }
  }
  return { status: 'CLEAN', matchedAlias: null };
}

/**
 * Discovery Query Guard：
 *   queryType=DISCOVERY 且污染命中 → 返回拒绝原因（TARGET_PRESENT_IN_DISCOVERY_QUERY），
 *   允许用户改 BRANDED_SANITY。CUSTOM 含目标 → 警告但仍允许（须明确确认）。
 */
export interface DiscoveryGuardResult {
  allowed: boolean;
  /** 命中时拒绝代码 */
  code: 'TARGET_PRESENT_IN_DISCOVERY_QUERY' | null;
  suggestion: 'BRANDED_SANITY' | null;
  contamination: ContaminationResult;
  message: string | null;
}

export function guardQueryType(
  requestedType: QuerySemanticType,
  queryText: string,
  target: TargetIdentity,
): DiscoveryGuardResult {
  const contamination = detectTargetContamination(queryText, target);
  if (requestedType === 'DISCOVERY' && contamination.status === 'TARGET_MENTIONED') {
    return {
      allowed: false,
      code: 'TARGET_PRESENT_IN_DISCOVERY_QUERY',
      suggestion: 'BRANDED_SANITY',
      contamination,
      message: '该问题包含当前监测品牌，会使自然可见度指标偏高。请移除品牌名，或改为品牌认知测试（BRANDED_SANITY）。',
    };
  }
  if (requestedType === 'CUSTOM' && contamination.status === 'TARGET_MENTIONED') {
    return {
      allowed: true,
      code: null,
      suggestion: null,
      contamination,
      message: '该自定义问题包含监测品牌，将不计入自然可见度主指标（若需计入 DISCOVERY 会被拒绝；如为品牌测试请选 BRANDED_SANITY）。',
    };
  }
  if (requestedType === 'BRANDED_SANITY' && contamination.status === 'CLEAN') {
    return {
      allowed: true,
      code: null,
      suggestion: null,
      contamination,
      message: '品牌认知测试通常应包含品牌名；若该问题不含品牌，是否确认作为 SANITY 保留？',
    };
  }
  return { allowed: true, code: null, suggestion: null, contamination, message: null };
}

/** POSSIBLE_TARGET_MENTION（如只在 URL）→ DISCOVERY 仍允许但需 UI 提示。 */
export function isDiscoveryAmbiguous(contamination: ContaminationResult): boolean {
  return contamination.status === 'POSSIBLE_TARGET_MENTION';
}

// ---------------------------------------------------------------------------
// Query Builder（deterministic templates）
// ---------------------------------------------------------------------------

export type BuilderIntent =
  | 'RECOMMEND' | 'HOW_TO' | 'COMPARE' | 'PROBLEM_SOLVING' | 'INFORMATIONAL';

export interface BuilderInput {
  category: string;          // 产品类别，如「大学生创新创业 AI 工具」「CRM SaaS」
  scenario?: string[];       // 场景，如 国创赛 / 商业计划书 / 答辩
  intents?: BuilderIntent[]; // 默认 [RECOMMEND]
  audience?: string[];       // 人群，如 大学生 / 创业团队
  modifiers?: string[];      // 附加条件，如 免费 / 小团队 / 5000 元以内
  custom?: string[];         // 用户直接添加的自定义 query
  cap?: number;              // preview cap（默认 100）
}

export interface BuilderQueryRow {
  text: string;
  category: string;
  intent: BuilderIntent | 'CUSTOM';
  queryType: QuerySemanticType;
  contamination: ContaminationResult;
}

const INTENT_ORDER: BuilderIntent[] = ['RECOMMEND', 'HOW_TO', 'COMPARE', 'PROBLEM_SOLVING', 'INFORMATIONAL'];

export type DomainArchetype = 'EDUCATION' | 'CONSUMER_HARDWARE' | 'ENTERPRISE_SOFTWARE' | 'GENERAL';

export function detectDomainArchetype(category: string, scenario?: string): DomainArchetype {
  const combined = `${category} ${scenario ?? ''}`.trim();
  const isSoftwareSuffix = /(?:AI|软件|系统|平台|工具|app|saas|crm|erp)$/i.test(category.trim());

  if (!isSoftwareSuffix && /(?:专业|大学|学院|教育|考研|高考|学科|高校|招生|选科|课程|工程)/i.test(combined)) {
    return 'EDUCATION';
  }
  if (!isSoftwareSuffix && /(?:洗地机|扫地机|吸尘器|家电|数码|手机|硬件|耳机|电视|空调|冰箱|洗衣机|相机|汽车)/i.test(combined)) {
    return 'CONSUMER_HARDWARE';
  }
  if (/(?:SaaS|CRM|ERP|软件|系统|平台|数字化|协同|管理工具)/i.test(combined)) {
    return 'ENTERPRISE_SOFTWARE';
  }
  return 'GENERAL';
}

/** 模板（category 自然融入；target 品牌永不进入模板；根据行业特征动态适配自然问法）。 */
export const QUERY_TEMPLATES: Record<BuilderIntent, Array<(ctx: { category: string; scenario?: string; audience?: string; modifier?: string }) => string>> = {
  RECOMMEND: [
    ({ category, scenario }) => {
      const domain = detectDomainArchetype(category, scenario);
      if (domain === 'EDUCATION') return `${category}有哪些实力强、口碑好的院校推荐？`;
      if (domain === 'CONSUMER_HARDWARE') return `${category}有哪些口碑和性能比较好的推荐？`;
      return `${category}有哪些值得推荐的工具？`;
    },
    ({ category, scenario, audience }) => {
      const domain = detectDomainArchetype(category, scenario);
      if (domain === 'EDUCATION') {
        return audience
          ? `${audience}报考${category}有什么院校或方向推荐？`
          : `做${scenario ?? '相关规划'}有什么${category}院校或方向推荐？`;
      }
      if (domain === 'CONSUMER_HARDWARE') {
        return audience
          ? `${audience}家用适合选购哪些${category}？`
          : `做${scenario ?? '家庭清洁'}可以使用哪些${category}？`;
      }
      return (audience ? `${audience}做${scenario ?? '相关工作'}可以使用哪些${category}？` : `做${scenario ?? '相关工作'}可以使用哪些${category}？`);
    },
    ({ category, scenario }) => {
      const domain = detectDomainArchetype(category, scenario);
      if (domain === 'EDUCATION') {
        return scenario
          ? `在${scenario}方向上，${category}有哪些优质高校推荐？`
          : `想深入了解${category}，有哪些优质高校或方向推荐？`;
      }
      if (domain === 'CONSUMER_HARDWARE') {
        return scenario
          ? `针对${scenario}场景，有什么高性价比${category}推荐？`
          : `日常选购有什么高口碑${category}推荐？`;
      }
      return `做${scenario ?? '相关工作'}有什么${category}推荐？`;
    },
  ],
  HOW_TO: [
    ({ category, scenario, audience }) => {
      const domain = detectDomainArchetype(category, scenario);
      if (domain === 'EDUCATION') {
        return audience
          ? `${audience}怎么深入学好${category}并做好职业规划？`
          : `怎么学好${category}并掌握核心专业技能？`;
      }
      if (domain === 'CONSUMER_HARDWARE') {
        return audience
          ? `${audience}怎么挑选适合自己的${category}？`
          : `怎么挑选${category}才能不踩坑？重点看哪些核心指标？`;
      }
      return (audience ? `${audience}怎么用${category}完成${scenario ?? '任务'}？` : `怎么用${category}完成${scenario ?? '任务'}？`);
    },
    ({ category, scenario }) => {
      const domain = detectDomainArchetype(category, scenario);
      if (domain === 'EDUCATION') {
        return scenario
          ? `围绕${scenario}，学习${category}需要重点掌握哪些核心知识？`
          : `报考与学习${category}一般需要具备哪些学科基础？`;
      }
      if (domain === 'CONSUMER_HARDWARE') {
        return scenario
          ? `针对${scenario}，选购和使用${category}需要注意哪些事项？`
          : `选购主流${category}一般需要重点了解哪些核心功能？`;
      }
      return `做${scenario ?? '任务'}一般需要哪些${category}工具？`;
    },
  ],
  COMPARE: [
    ({ category, scenario }) => {
      const domain = detectDomainArchetype(category, scenario);
      if (domain === 'EDUCATION') {
        return scenario
          ? `在${scenario}领域，不同高校开设的${category}有什么特色区别？`
          : `不同高校开设的${category}专业该怎么对比选校？`;
      }
      if (domain === 'CONSUMER_HARDWARE') {
        return scenario
          ? `在${scenario}使用场景下，不同类型的${category}怎么选？`
          : `市面上不同价位与类型的${category}该怎么选？`;
      }
      return `做${scenario ?? '任务'}时不同类型的${category}怎么选？`;
    },
    ({ category, scenario }) => {
      const domain = detectDomainArchetype(category, scenario);
      if (domain === 'EDUCATION') return `${category}和相近学科专业相比有哪些核心优势与区别？`;
      if (domain === 'CONSUMER_HARDWARE') return `几款常见的${category}横评对比，哪个更适合普通家庭？`;
      return `几款常见的${category}哪个更适合新手？`;
    },
  ],
  PROBLEM_SOLVING: [
    ({ category, scenario, audience, modifier }) => {
      const domain = detectDomainArchetype(category, scenario);
      if (domain === 'EDUCATION') {
        return audience
          ? `${audience}学${category}${modifier ? `遇到${modifier}` : ''}毕业后就业前景怎么样？`
          : `学${category}${modifier ? `在${modifier}情况下` : ''}主要有哪些对口就业出路？`;
      }
      if (domain === 'CONSUMER_HARDWARE') {
        return audience
          ? `${audience}使用${category}${modifier ? `遇到${modifier}` : ''}该怎么解决与避坑？`
          : `选购与使用${category}${modifier ? `遇到${modifier}` : ''}该怎么避免踩坑？`;
      }
      return (audience ? `${audience}做${scenario ?? '任务'}${modifier ? `遇到${modifier}` : ''}可以用什么${category}解决？` : `做${scenario ?? '任务'}${modifier ? `遇到${modifier}` : ''}可以用什么${category}解决？`);
    },
  ],
  INFORMATIONAL: [
    ({ category, scenario }) => {
      const domain = detectDomainArchetype(category, scenario);
      if (domain === 'EDUCATION') return `${category}主要学习哪些核心课程与知识体系？`;
      if (domain === 'CONSUMER_HARDWARE') return `优质的${category}一般具备哪些核心功能与指标？`;
      return `${category}一般包含哪些能力？`;
    },
    ({ category, scenario }) => {
      const domain = detectDomainArchetype(category, scenario);
      if (domain === 'EDUCATION') return `${category}在${scenario ?? '实际产业与就业岗位'}中主要对应哪些应用方向？`;
      if (domain === 'CONSUMER_HARDWARE') return `${category}在${scenario ?? '日常清洁与实际居家'}中的使用体验如何？`;
      return `${category}在${scenario ?? '这类场景'}中能做什么？`;
    },
  ],
};

export function buildQueries(input: BuilderInput, target: TargetIdentity = { canonicalName: '__NO_TARGET__' }): BuilderQueryRow[] {
  const intents = (input.intents && input.intents.length > 0 ? input.intents : ['RECOMMEND'] as BuilderIntent[])
    .filter(intent => INTENT_ORDER.includes(intent))
    .sort((a, b) => INTENT_ORDER.indexOf(a) - INTENT_ORDER.indexOf(b));
  // 确定性：对自由文本输入做稳定排序，避免"同组合、输入顺序不同"产出不同顺序
  const sortStable = (arr: string[]) => arr.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const scenarios = sortStable((input.scenario ?? []).filter(s => s && s.trim().length > 0).map(s => s.trim()));
  const audiences = sortStable((input.audience ?? []).filter(a => a && a.trim().length > 0).map(a => a.trim()));
  const modifiers = sortStable((input.modifiers ?? []).filter(m => m && m.trim().length > 0).map(m => m.trim()));
  const category = input.category.trim();
  const seen = new Set<string>();
  const rows: BuilderQueryRow[] = [];

  const push = (text: string, intent: BuilderIntent | 'CUSTOM') => {
    const clean = text.replace(/\s+/gu, ' ').trim();
    if (!clean) return;
    const key = normalizeQueryText(clean);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ text: clean, category, intent, queryType: 'DISCOVERY', contamination: detectTargetContamination(clean, target) });
  };

  // 无任何结构化输入时至少输出一个基础模板，避免空 builder
  const noStructured = scenarios.length === 0 && audiences.length === 0 && modifiers.length === 0;
  for (const intent of intents) {
    const templates = QUERY_TEMPLATES[intent];
    const scenarioPool = scenarios.length > 0 ? scenarios : [undefined];
    const audiencePool = audiences.length > 0 ? audiences : [undefined];
    const modifierPool = modifiers.length > 0 ? modifiers : [undefined];
    for (const scenario of scenarioPool) {
      for (const audience of audiencePool) {
        for (const modifier of modifierPool) {
          for (const tmpl of templates) {
            push(tmpl({ category, scenario, audience, modifier }), intent);
            if (rows.length >= (input.cap ?? 100)) break;
          }
          if (rows.length >= (input.cap ?? 100)) break;
        }
        if (rows.length >= (input.cap ?? 100)) break;
      }
      if (rows.length >= (input.cap ?? 100)) break;
    }
    if (noStructured && intent === 'RECOMMEND') break; // 只出一个兜底模板
    if (rows.length >= (input.cap ?? 100)) break;
  }

  for (const custom of input.custom ?? []) {
    const clean = custom.trim();
    if (clean) push(clean, 'CUSTOM');
    if (rows.length >= (input.cap ?? 100)) break;
  }

  return rows;
}

/** Builder 统计：总数 / 去重后（构造即去重）/ 污染数 —— 让 UI 在保存前展示规模。 */
export function builderSummary(input: BuilderInput, target?: TargetIdentity) {
  const rows = buildQueries(input, target);
  return {
    estimated: rows.length,
    targetContaminated: rows.filter(r => r.contamination.status === 'TARGET_MENTIONED').length,
    rows,
  };
}

/** 校验 builder 输入规模（组合爆炸防线）：返回放行前的计数。 */
export function estimatedBuilderCount(input: BuilderInput): number {
  const rows = buildQueries({ ...input, cap: 1000000 });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Metrics Scope（denominator 可审计）
// ---------------------------------------------------------------------------
// 核心 GEO 主指标 denominator 只含：
//   - DISCOVERY（自然发现）
//   - non-branded CUSTOM（不含目标品牌；含目标品牌必须经用户确认，默认不入）
// 排除：
//   - BRANDED_SANITY（品牌认知测试；单独展示）
//   - 任何被目标污染标记的 CUSTOM（未确认）
//   - legacy sanity=true 行（queryType 未写入前按旧口径解释）
export interface MetricScopeRow {
  queryType?: string | null;
  sanity?: boolean | null;
  contamination?: { status?: string } | null;
}

export interface MetricScopeResult {
  /** 主指标 scope：v1 固定 DISCOVERY_ONLY（含非品牌 CUSTOM，可审计） */
  metricQueryScope: 'DISCOVERY_ONLY';
  eligibleQueryCount: number;
  excludedSanityCount: number;
  excludedContaminatedCount: number;
  excludedQueryCount: number;
  totalRows: number;
}

export function isMetricEligible(row: MetricScopeRow): boolean {
  const qt = row.queryType ?? null;
  if (qt === 'BRANDED_SANITY') return false;
  if (row.sanity === true) return false;
  if (qt === 'CUSTOM' && row.contamination?.status === 'TARGET_MENTIONED') return false;
  return true;
}

export function computeMetricScope(rows: MetricScopeRow[]): MetricScopeResult {
  let eligible = 0;
  let sanity = 0;
  let contaminated = 0;
  for (const row of rows) {
    if (isMetricEligible(row)) { eligible += 1; continue; }
    const qt = row.queryType ?? null;
    if (qt === 'BRANDED_SANITY' || row.sanity === true) sanity += 1;
    else if (qt === 'CUSTOM' && row.contamination?.status === 'TARGET_MENTIONED') contaminated += 1;
    else sanity += 1; // legacy 未知一律按排除计数（诚实保守：不冒充 eligible）
  }
  return {
    metricQueryScope: 'DISCOVERY_ONLY',
    eligibleQueryCount: eligible,
    excludedSanityCount: sanity,
    excludedContaminatedCount: contaminated,
    excludedQueryCount: rows.length - eligible,
    totalRows: rows.length,
  };
}
