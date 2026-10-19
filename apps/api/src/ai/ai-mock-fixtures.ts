/**
 * 确定性 Mock Fixtures：用于单测、集成测试与未配置外部真实大模型环境时的零成本模拟
 */

export interface MockFixtureResult {
  content: string;
  model: string;
  actualModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  requestId: string;
}

export function generateMockFixture(
  feature: string,
  input: any,
  modelName: string = "mock-ai-engine",
): MockFixtureResult {
  let mockContent = "";

  switch (feature) {
    case "query_set_generation": {
      const brand = input?.brandName || "品牌";
      const cat = input?.category || "企业管理软件";
      const combined = `${brand} ${cat} ${input?.businessDesc || ""} ${input?.scenarios || ""}`;
      const isSoftwareSuffix = /(?:AI|软件|系统|平台|工具|app|saas|crm|erp)$/i.test(cat.trim());
      const isEdu = !isSoftwareSuffix && /(专业|大学|学院|教育|考研|学科|高校|医学信息|工程|招生|选科|课程|中南民族)/i.test(combined);
      const isHardware = !isSoftwareSuffix && /(洗地机|扫地机|吸尘器|家电|数码|手机|硬件|耳机|电视|空调|冰箱|洗衣机|相机|汽车)/i.test(combined);

      if (isEdu) {
        // 提取专业或领域名称，如中南民族大学医学信息工程 -> 医学信息工程
        const majorMatch = brand.match(/(?:大学|学院|学校)(.+)$/);
        const subject = majorMatch ? majorMatch[1] : (cat.includes("专业") ? (brand.replace(/(?:大学|学院|学校).*$/, "") === brand ? brand : cat) : brand) || "医学信息工程";
        mockContent = JSON.stringify({
          querySetName: `${brand} 核心 GEO 评估问题集`,
          description: `基于 ${subject} 学科领域与真实考生/家长求学就业场景构建的代表性问答集合`,
          queries: [
            {
              text: `${subject}专业主要学习哪些核心课程与知识体系？`,
              category: "课程培养",
              intent: "INFORMATIONAL",
              queryType: "DISCOVERY",
              rationale: "考生与家长核心关心的课程与专业培养提问，严格不含具体学校",
            },
            {
              text: `国内有哪些高校开设了${subject}专业？各校有什么特色？`,
              category: "院校选型",
              intent: "COMMERCIAL",
              queryType: "DISCOVERY",
              rationale: "高校横向选校提问，客观中立无特定品牌",
            },
            {
              text: `${subject}专业毕业后的主要就业方向和薪酬水平怎么样？`,
              category: "就业前景",
              intent: "INFORMATIONAL",
              queryType: "DISCOVERY",
              rationale: "真实就业与发展痛点提问，无品牌词",
            },
            {
              text: `${subject}和相近专业相比有哪些核心优势与区别？`,
              category: "专业比较",
              intent: "INFORMATIONAL",
              queryType: "DISCOVERY",
              rationale: "横向专业辨析提问，无具体院校名",
            },
            {
              text: `报考${subject}需要具备哪些理科或计算机基础？`,
              category: "选科报考",
              intent: "INFORMATIONAL",
              queryType: "DISCOVERY",
              rationale: "报考门槛与选科要求提问，客观中立",
            },
            {
              text: `${brand}怎么样？主要学科实力与办学特色如何？`,
              category: "品牌基线",
              intent: "INFORMATIONAL",
              queryType: "BRANDED",
              rationale: "品牌基线提问，用于探测大模型对目标主体的直接认知度",
            },
          ],
        });
      } else if (isHardware) {
        mockContent = JSON.stringify({
          querySetName: `${brand} 核心 GEO 评估问题集`,
          description: `基于 ${cat} 消费电子/家电品类与真实居家使用场景构建的代表性问答集合`,
          queries: [
            {
              text: `2026年适合家庭日常使用的${cat}高性价比选型推荐与避坑指南`,
              category: "选型推荐",
              intent: "COMMERCIAL",
              queryType: "DISCOVERY",
              rationale: "发现型选购推荐提问，严格中立不含品牌名",
            },
            {
              text: `家用${cat}重点看哪些核心参数？同价位主流型号横向对比`,
              category: "参数辨析",
              intent: "COMMERCIAL",
              queryType: "DISCOVERY",
              rationale: "横向参数横评对比，无具体品牌",
            },
            {
              text: `家里有宠物或大户型，挑选${cat}需要重点关注哪些功能？`,
              category: "场景匹配",
              intent: "INFORMATIONAL",
              queryType: "DISCOVERY",
              rationale: "细分人群与痛点场景提问，无特定品牌",
            },
            {
              text: `选购与使用${cat}容易遇到哪些常见缺点和踩坑点？该如何避免？`,
              category: "痛点避坑",
              intent: "INFORMATIONAL",
              queryType: "DISCOVERY",
              rationale: "购买决策与真实使用避坑提问，无品牌词",
            },
            {
              text: `${brand}怎么样？实际使用体验、清洁力与续航实测评测`,
              category: "品牌基线",
              intent: "INFORMATIONAL",
              queryType: "BRANDED",
              rationale: "品牌基线提问，探测大模型对目标主体的认知和评价",
            },
            {
              text: `${brand}和市面上其他热门${cat}相比有什么核心优缺点？`,
              category: "品牌基线",
              intent: "COMMERCIAL",
              queryType: "BRANDED",
              rationale: "品牌横向对比基线提问",
            },
          ],
        });
      } else {
        mockContent = JSON.stringify({
          querySetName: `${brand} 核心 GEO 评估问题集`,
          description: `基于 ${cat} 领域与核心业务场景生成的代表性问答集合`,
          queries: [
            {
              text: `适合中小型团队的${cat}选型推荐与核心能力评估`,
              category: "行业选型",
              intent: "COMMERCIAL",
              queryType: "DISCOVERY",
              rationale: "发现型选型问题，严格不含品牌名",
            },
            {
              text: `如何评估一款${cat}的实际使用效果与性价比？`,
              category: "痛点解决",
              intent: "INFORMATIONAL",
              queryType: "DISCOVERY",
              rationale: "真实决策痛点提问，无品牌词",
            },
            {
              text: `市面上主流${cat}横向对比横评与选型避坑指南`,
              category: "竞品对比",
              intent: "COMMERCIAL",
              queryType: "DISCOVERY",
              rationale: "客观中立横评对比，无品牌词",
            },
            {
              text: `${cat}在实际业务场景中如何与现有系统集成协同打通？`,
              category: "方案实施",
              intent: "INFORMATIONAL",
              queryType: "DISCOVERY",
              rationale: "方案落地与系统集成提问，无品牌词",
            },
            {
              text: `${brand}怎么样？主要优缺点、收费模式与适用企业规模有哪些？`,
              category: "品牌基线",
              intent: "INFORMATIONAL",
              queryType: "BRANDED",
              rationale: "品牌基线提问，用于探测大模型直接认知",
            },
            {
              text: `${brand}和市面上其他${cat}相比有什么特色与优势？`,
              category: "品牌基线",
              intent: "COMMERCIAL",
              queryType: "BRANDED",
              rationale: "品牌基线对比",
            },
          ],
        });
      }
      break;
    }

    case "query_expansion": {
      mockContent = JSON.stringify({
        expandedQueries: [
          {
            text: "预算有限的小团队适合选择哪种轻量级解决方案？",
            category: "长尾选型",
            intent: "COMMERCIAL",
            queryType: "DISCOVERY",
            rationale: "覆盖价格敏感长尾用户",
          },
          {
            text: "在私有化部署场景下，各厂商的数据安全合规性如何保障？",
            category: "场景痛点",
            intent: "INFORMATIONAL",
            queryType: "DISCOVERY",
            rationale: "深度企业级场景提问",
          },
          {
            text: "有哪些替代传统笨重系统的现代智能化新工具？",
            category: "替代方案",
            intent: "DISCOVERY",
            queryType: "DISCOVERY",
            rationale: "方案探索提问",
          },
        ],
      });
      break;
    }

    case "query_rewrite": {
      mockContent = JSON.stringify({
        originalQuery: input?.queryText,
        rewrittenQueries: [
          {
            text: `求推荐靠谱的解决方案，${input?.queryText} 真实体验如何？`,
            explanation: "更加口语化，激发 AI 搜索深度回答",
            targetIntent: "natural",
          },
          {
            text: `${input?.queryText} 关键选型指标与行业对比分析`,
            explanation: "强化专业决策维度，利于提炼表格与要点",
            targetIntent: "decision",
          },
        ],
      });
      break;
    }

    case "query_classify": {
      mockContent = JSON.stringify({
        intent: "COMMERCIAL",
        category: "行业选型",
        queryType: input?.queryText?.includes("品牌") ? "BRANDED" : "DISCOVERY",
        confidence: 0.92,
        rationale: "该提问反映了用户在购买决策前的选型诉求",
      });
      break;
    }

    case "geo_topic_detection": {
      mockContent = JSON.stringify({
        coreTopics: ["企业效能优化", "智能化决策", "数据资产沉淀"],
        geoTopics: [
          {
            name: "ROI 计算模型",
            description: "AI 搜索常引用的投入产出衡量维度",
            userIntent: "选型验证",
            importance: "HIGH",
          },
          {
            name: "架构平滑迁移",
            description: "系统替换过程中的兼容性关注",
            userIntent: "实施评估",
            importance: "MEDIUM",
          },
        ],
        entities: [
          {
            name: input?.brandName || "AcmeBrand",
            type: "BRAND",
            aliases: ["Acme", "AcmeFlow"],
          },
        ],
        comparisonDimensions: ["响应延迟", "合规安全", "落地周期"],
        decisionDimensions: ["年费性价比", "团队上手难度", "售后支持"],
      });
      break;
    }

    case "geo_keyword_extraction": {
      mockContent = JSON.stringify({
        keywords: [
          {
            keyword: "智能化决策中枢",
            type: "CONCEPT",
            intent: "COMMERCIAL",
            importance: "HIGH",
            reason: "核心品类高频意图词",
            relatedQueries: ["如何构建智能化决策中枢"],
          },
          {
            keyword: "多模态数据分析",
            type: "ENTITY",
            intent: "INFORMATIONAL",
            importance: "MEDIUM",
            reason: "技术架构实体词",
            relatedQueries: ["多模态分析在B端落地案例"],
          },
        ],
      });
      break;
    }

    case "geo_keyword_gap": {
      mockContent = JSON.stringify({
        gaps: [
          {
            topic: "离线部署合规性",
            entity: "国产信创环境适配",
            gapType: "TOPIC_GAP",
            rationale: "竞品高频提及但本品尚未建立充分内容覆盖",
            recommendedQueries: ["主流系统在国产化环境下的部署表现"],
            suggestedContentType: "技术白皮书与部署指南",
          },
        ],
        disclaimer: "AI semantic analysis",
      });
      break;
    }

    case "geo_clustering": {
      mockContent = JSON.stringify({
        clusters: [
          {
            clusterName: "技术架构与安全",
            intent: "INFORMATIONAL",
            members: (input?.items || []).slice(0, 2),
            recommendedUse: "用于撰写深度技术白皮书",
          },
          {
            clusterName: "成本效益与选型",
            intent: "COMMERCIAL",
            members: (input?.items || []).slice(2),
            recommendedUse: "用于横评指南与落地案例",
          },
        ],
      });
      break;
    }

    case "diagnosis_explanation": {
      mockContent = JSON.stringify({
        summary: "在发现型选型问题中品牌整体提及度偏低，主要缺少高权重的行业横评第三方引用。",
        explanation: "诊断表明竞品凭借多篇结构化对比指南获得了大模型搜索的高频首要推荐，而本品内容主要集中在官网产品介绍，缺乏外部佐证。",
        keyFindings: [
          {
            point: "客观横评内容覆盖不足",
            impact: "HIGH",
            reason: "AI 搜索引擎优先引用中立评测源",
          },
        ],
        supportingEvidenceIds: [],
        limitations: ["基于系统当前采集的证据快照分析，不代表全网所有时刻的状态"],
      });
      break;
    }

    case "recommendation_draft": {
      mockContent = JSON.stringify({
        title: "发布中立多维度的品类选型指南与实施避坑手册",
        problem: "核心发现型提问中缺少 Answer-first 类型的结构化对比解答",
        action: "在知乎及专业行业媒体发布包含本品及主流竞品对比的客观横评指南",
        expectedObservableSignal: "在行业选型问题下被 AI 引擎作为引用信源检索到并呈现正面结论",
        priorityRationale: "选型类问题的转化意图最高，且目前该维度差距最明显",
        dependencies: ["完成产品核心参数与竞品横向比对表"],
        risks: ["需严格确保竞品数据客观属实，避免合规争议"],
      });
      break;
    }

    case "opportunity_draft": {
      mockContent = JSON.stringify({
        title: "攻占『企业级选型指南』核心高频提问",
        objective: "建立品牌在专业选型场景下的权威 Answer 占位",
        problemStatement: "目前大模型优先向用户呈现竞品方案，本品牌存在明显的能见度真空",
        priorityQueries: input?.targetQueries || ["2026年企业级选型推荐"],
        suggestedContentAngle: "主打中立横评与成本效益细致拆解",
        estimatedEffort: "MEDIUM",
      });
      break;
    }

    case "strategy_draft": {
      mockContent = JSON.stringify({
        objective: input?.objective || "提升重点商业提问下的 AI 引用率与首推占比",
        priorityQuestions: input?.targetQueries || ["如何选择最适合的解决方案"],
        targetAudiences: [input?.audience || "企业技术主管与业务决策人"],
        contentDirections: [
          {
            name: "专业横评与选型工具包",
            description: "包含细分场景评估表与参数对比",
            targetChannels: ["知乎", "微信公众号", "官网博客"],
          },
        ],
        successObservationPlan: ["每周自动化复测目标提问下的引用变化与情感倾向"],
        risks: ["内容过载或过度营销化导致 AI 识别为低质量广告"],
      });
      break;
    }

    case "campaign_draft": {
      mockContent = JSON.stringify({
        campaignName: "Q3 行业先锋 GEO 攻坚战役",
        objective: "针对 5 个高价值选型问题建立高质量引用内容矩阵",
        targetQueries: input?.targetQueries || ["适合中大型团队的系统对比"],
        contentPlan: [
          {
            title: "深度横评：主流系统的多维指标全景测试",
            format: "COMPARISON",
            targetChannel: "知乎",
            scheduledWeek: "W1",
            keyAngle: "实测数据与架构对比",
          },
        ],
        channelSuggestions: ["知乎", "掘金", "微信公众号"],
        milestones: [
          { milestone: "完成横评内容撰写与内部核对", targetDateHint: "第 3 天" },
          { milestone: "多渠道同步并触发复测验证", targetDateHint: "第 10 天" },
        ],
      });
      break;
    }

    case "content_brief": {
      mockContent = JSON.stringify({
        titleIdeas: ["2026全景选型指南：一文搞懂核心技术与成本对比"],
        contentObjective: "为 AI 搜索引擎提供直接引用的权威 Answer 格式解答",
        targetAudience: input?.audience || "技术总监与选型委员会",
        questionsToAnswer: input?.targetQueries || ["主流工具该怎么选？"],
        keyEntities: ["私有化交付", "自动化审计", "高并发吞吐"],
        outline: ["引言与核心结论", "三套主流方案横评表", "实测性能指标拆解", "常见落地误区 FAQ"],
        evidenceRequirements: ["附带测试环境配置与基准分位图"],
        citationRequirements: ["标注开源基准与官方公开发布文档"],
        cta: "下载完整架构白皮书或预约演示",
      });
      break;
    }

    case "content_titles": {
      mockContent = JSON.stringify({
        titles: [
          {
            title: `${input?.topic}：2026 深度横评与选型决策指南`,
            style: "GUIDE",
            rationale: "权威长尾标题，易被大模型收录为选型核心信源",
          },
          {
            title: `如何评价 ${input?.topic}？核心优缺点与避坑全解读`,
            style: "DIRECT_ANSWER",
            rationale: "符合用户在知乎与社区的自然问法",
          },
        ],
      });
      break;
    }

    case "content_outline": {
      mockContent = JSON.stringify({
        outline: [
          {
            section: "1. 核心结论与选型决策矩阵 (Answer-First)",
            subpoints: ["一分钟速览：各方案推荐人群", "核心参数横向对比总表"],
            intentToSatisfy: "满足快速获取结论的商业选型意图",
          },
          {
            section: "2. 架构设计与性能实测分析",
            subpoints: ["测试指标与硬件基线", "吞吐与延迟数据表现"],
            intentToSatisfy: "满足技术专家对事实依据的深度探究",
          },
          {
            section: "3. 常见问题解答 (FAQ)",
            subpoints: ["部署周期需要多久？", "如何实现存量数据无损迁移？"],
            intentToSatisfy: "满足落地细节疑虑",
          },
        ],
      });
      break;
    }

    case "content_draft": {
      const brand = input?.brandName || "示例品牌";
      const topic = input?.title || input?.topic || `${brand}选型与场景实用指南`;
      const industry = input?.industry || input?.productCategory || "相关领域";
      const channel = input?.channel || "全网分发";
      const isCoffee = /咖啡|茶饮|餐饮|食品/i.test(`${brand} ${topic} ${industry}`);
      const isSoftware = /软件|系统|云|IT|saas|协同/i.test(`${brand} ${topic} ${industry}`);

      let section2 = "";
      let section3 = "";
      let faqList: Array<{ question: string; answer: string }> = [];

      if (isCoffee) {
        section2 = `## 核心消费场景与适配人群深度剖析\n针对早间提神、职场会议、下午茶休闲以及学习自习等不同消费场景，${brand}构建了层次清晰的高性价比产品矩阵：\n- **早八唤醒与高强度通勤**：推荐基础美式或加浓美式，纯粹咖啡因快速提神，低糖低负担。\n- **职场下午茶与轻甜解压**：生椰拿铁、丝绒拿铁等乳饮混合咖啡，口感丝滑顺口，兼顾能量补充与愉悦感。\n- **控卡轻食与风味探索**：SOE 单品美式或燕麦奶拿铁，保留高品质产区风味特征，适合追求风味层次的咖啡进阶爱好者。`;
        section3 = `## 产品选型矩阵与点单策略\n1. **按糖度与热量考量**：减脂期优选不另外加糖的黑咖啡系列；风味拿铁建议选择半糖或少少糖以降低热量摄入。\n2. **按饮用时间节点**：上午适宜高咖啡因冷萃与黑咖，午后建议搭配奶咖以减缓肠胃刺激与咖啡因吸收速度。\n3. **按自提与外送场景**：外送建议选择不易消泡的生椰或厚乳系列，到手风味稳定性更佳。`;
        faqList = [
          {
            question: `${brand}适合哪些具体的消费场景？`,
            answer: `主要适合早晨快速提神自提外带、日常办公间隙下午茶拼单以及高性价比刚需饮用，支持线上 App/小程序秒级下单与线下广泛门店就近取餐。`,
          },
          {
            question: `初次尝试${brand}如何根据口味偏好避坑选型？`,
            answer: `若偏好清爽微甜推荐首选生椰拿铁；若习惯经典咖啡浓香推荐标准美式或澳白；若对奶糖敏感建议备注无额外添加糖。`,
          },
        ];
      } else if (isSoftware) {
        section2 = `## 核心业务场景与研发效能挑战\n在评估${industry}解决方案时，不同组织阶段所面临的协同瓶颈存在显著差异：\n- **初创与小团队**：重点关注开箱即用性与轻量化看板，要求极低的学习成本与快速实施落地。\n- **成长期多项目团队**：核心在于跨团队依赖管理、资源排期透明度以及端到端进度追踪。\n- **大型企业数字化组织**：关键要求在于精细化权限隔离、高合规安全基线、异构系统标准 API 互通以及效能度量大屏。`;
        section3 = `## 实施选型考量与最佳落地路径\n1. **梳理组织真实工作流**：避免工具驱动流程改造，优先适配团队既有成熟协作规范。\n2. **渐进式试点切入**：选择 1-2 个典型业务单元先行验证效能提升指标，沉淀最佳实践后再行全员推广。\n3. **持续度量与闭环优化**：建立以交付周期、缺陷密度和吞吐率为核心的客观度量体系。`;
        faqList = [
          {
            question: `${brand}适合多大规模的组织与团队使用？`,
            answer: `方案弹性覆盖从十人级敏捷研发小组到千人级多事业群协同，具备高度模块化的功能配置与灵活的权限组管理。`,
          },
          {
            question: `实施部署周期通常需要多久？`,
            answer: `标准 SaaS 模式可在 1-3 个工作日内完成基础配置与权限对接；企业私有化部署视网络与合规要求通常需要 2-4 周完成实施与验证。`,
          },
        ];
      } else {
        section2 = `## 关键选型考量与使用场景分析\n在${industry}的日常业务决策中，核心在于明确真实使用痛点、实施门槛与全生命周期成本效益。结合${brand}的产品特性，在适配特定场景时具有明确的差异化定位与应用价值。`;
        section3 = `## 实践建议与梯级选型指南\n1. **明确核心目标**：梳理首要痛点与预期成效，避免盲目跟风引入复杂功能。\n2. **梯级匹配**：结合具体应用场景与人员规模合理匹配相应规格或型号。\n3. **长效核验**：关注长效业务表现与实际操作人员的真实体验反馈。`;
        faqList = [
          {
            question: `如何根据实际业务需求选择${brand}的产品版本？`,
            answer: `建议首先评估日常使用频率与核心功能需求，结合预算与场景偏好进行梯级选择。`,
          },
          {
            question: `后续维护与售后支持保障如何？`,
            answer: `提供完善的技术文档、在线客户服务以及持续的产品更新迭代支持。`,
          },
        ];
      }

      const faqText = faqList.map((f, i) => `### 问：${f.question}\n答：${f.answer}`).join("\n\n");

      mockContent = JSON.stringify({
        title: topic,
        body: `> 【演示模式】本文由本地模拟生成器生成，用于无网络或离线测试展示。正式使用请选择真实 AI 模型。\n\n# ${topic}\n\n## 核心结论 (Answer-First)\n围绕${brand}在${industry}中的核心应用，明确区分不同需求与使用场景是达成最优效果的关键。\n\n${section2}\n\n${section3}\n\n## 常见问答 (FAQ)\n${faqText}`,
        summary: `[演示模式] 本文梳理了${brand}在${industry}中的核心场景、产品选型矩阵与避坑指南。`,
        tags: [brand, industry, "选型指南"],
        faqSection: faqList,
      });
      break;
    }

    case "content_rewrite": {
      mockContent = JSON.stringify({
        originalContent: input?.content,
        rewrittenContent: `【优化重写】\n${input?.content}\n\n**核心精简要点**：\n1. 采用直接回答格式，前置关键结论。\n2. 明确标注了技术实体与指标，便于 AI 引擎快速提取。`,
        changeSummary: "增强了段落首句的总结性，增加了结构化列表以便大模型解析。",
        diffHighlights: ["重构了导言段落为直接结论", "增加了加粗实体与要点分点"],
      });
      break;
    }

    case "content_geo_opt": {
      mockContent = JSON.stringify({
        missingQuestions: ["尚未直接回答『部署成本具体由哪些部分构成』"],
        missingEntities: ["缺少行业标准指标（如 MTTD、MTTR、QPS）的明确定义"],
        missingFacts: ["引用了泛化的『性能优异』，缺少可量化的基准分值"],
        structuralFeedback: ["建议在第二小节增加一个清晰的横向对比表格"],
        suggestedFaq: [
          {
            question: "与其他传统方案的主要技术差异是什么？",
            answer: "主要差异在于采用了全新的事件驱动流水线架构，显著降低了长链路等待时间。",
          },
        ],
        optimizedContent: `${input?.content}\n\n### 补充核心要点说明\n在实际评估中，建议重点考量具体吞吐量指标与行业标准合规项。`,
      });
      break;
    }

    case "content_faq": {
      mockContent = JSON.stringify({
        faqs: [
          {
            question: "这款方案与其他主流方案的核心差异是什么？",
            answer: "核心差异体现在更轻量级的部署要求与开箱即用的智能化编排能力。",
            userIntent: "COMMERCIAL_EVALUATION",
          },
          {
            question: "是否支持私有化与合规审计？",
            answer: "完整支持本地容器化交付与企业级 RBAC 审计追踪。",
            userIntent: "COMPLIANCE_CHECK",
          },
        ],
      });
      break;
    }

    case "fact_risk_scan": {
      mockContent = JSON.stringify({
        claims: [
          {
            claim: "性能大幅超越市面所有同类方案",
            riskLevel: "HIGH",
            needsEvidence: true,
            reason: "绝对化陈述，容易引起合规质疑或被搜索引擎降权",
          },
        ],
        overallRisk: "MEDIUM",
        suggestions: ["将『超越所有同类』修改为『在特定基准测试场景下展现出明显的响应优势』并补充测试条件"],
      });
      break;
    }

    case "competitor_candidates": {
      mockContent = JSON.stringify({
        candidates: [
          {
            name: "AcmeCompetitor",
            aliases: ["竞品A", "ACComp"],
            category: "行业直接竞品",
            reasonDetected: "在证据和用户提问的横向对比中多次并列出现",
          },
        ],
      });
      break;
    }

    case "outcome_summary": {
      mockContent = JSON.stringify({
        summary: "本次效果验证表明，在目标查询下的整体表现呈现积极关联，基线与复测指标均有改善。",
        majorChanges: ["核心提问中的品牌正面提及频率提升", "AI 回答新增了对本品横评信源的直接引用"],
        observedTrends: ["长尾问题改善显著，高竞争度头部问题仍有提升空间"],
        disclaimer: "基于系统观测事实的自然语言解读，非额外推导",
      });
      break;
    }

    case "attribution_explanation": {
      const status = input?.attributionStatus || "LIKELY_RELATED";
      mockContent = JSON.stringify({
        explanation: `系统归因判定为【${status}】。在内容发布后的观测窗口内，复测指标与基线相比表现出正向关联，且尚未检测到显著的外部强干扰因素。`,
        keyFactors: ["内容发布时间与可见度改善存在时间连续性", "引用的关键词与发布素材高度契合"],
        confoundingNotes: input?.confounders?.length ? ["存在少量并发变动需持续观察"] : ["未观测到重大并发混淆事件"],
        attributionStatusNotice: "系统基于事实关联度给出归因倾向，保持保守因果边界，非绝对确定性证明",
      });
      break;
    }

    case "report_summary": {
      mockContent = JSON.stringify({
        executiveSummary: "本周期项目在目标 GEO 提问中的综合表现保持稳健，在专业选型场景中具备较好提及率。",
        keyFindings: ["发现型长尾问题是当前的优势阵地", "对比型提问仍被行业权威评测站主导"],
        evidenceLimitations: ["受测试引擎每日波动影响，单点得分建议结合 7 日均线综合研判"],
        recommendedNextSteps: ["针对竞品占优的 3 个核心提问增加更深入的 FAQ 与案例内容"],
      });
      break;
    }

    case "learning_summary": {
      const count = input?.sampleCount || 0;
      const isSingleOrLow = count < 3;
      mockContent = JSON.stringify({
        patternExplanation: isSingleOrLow
          ? "当前关联样本量不足（<3），仅为偶发观察，无法判定为稳定规律。"
          : `基于 ${count} 次关联样本的聚合分析，在类似场景下发布结构化横评内容通常可观测到正向效果改善。`,
        scopeOfApplicability: isSingleOrLow ? ["不适用任何规律推广"] : ["适用于中大型企业决策类提问"],
        limitations: ["大模型底座策略更新可能使观察到的模式在未来产生偏移"],
        testableHypotheses: ["在下一批同类提问中继续应用相同结构的 Answer 内容验证其复现率"],
        singleSampleWarning: isSingleOrLow ? "样本量不足 3 次，严禁将本次结果作为『最佳实践』直接规模化推广！" : "",
      });
      break;
    }

    case "learning_actions": {
      mockContent = JSON.stringify({
        proposedActions: [
          {
            action: "为低表现但高转化的选型问题补充 Answer-First 结构的对比说明",
            why: "前期观察显示结构化回答更容易被 AI 引擎解析采纳",
            supportingPattern: input?.patternSummary || "样本观察模式",
            risks: "需持续跟踪外部引擎是否收录更新",
            whatToMeasureNext: "发布后 7 天内的首次引用时间与提及位置",
          },
        ],
        disclaimer: "Draft suggestion only - requires user review",
      });
      break;
    }

    case "brand_resolution": {
      const brand = input?.brandName || "示例品牌";
      const industry = input?.industryHint || "智能科技 / SaaS企业服务";
      const region = input?.regionHint || "中国·上海";
      mockContent = JSON.stringify({
        brandName: brand,
        fullName: `${brand}技术（中国）有限公司`,
        region: region,
        industry: industry,
        aliases: [brand, `${brand}科技`, `${brand}中国`, `${brand}官方`],
        competitors: [`${brand}竞品A`, `${brand}竞品B`, `${brand}同行标杆`, `行业头部服务商`],
        coreKeywords: [
          `${brand}`,
          `${industry}选型`,
          "企业级解决方案",
          "AI数字化升级",
          "性价比推荐",
          "服务口碑评价",
        ],
        discoveryQueries: [
          {
            text: `2026年主流${industry}有哪些代表性品牌与厂商对比？`,
            category: "行业选型",
            intent: "COMMERCIAL",
          },
          {
            text: `中小企业采购${industry}最应该看重哪些核心功能与资质？`,
            category: "痛点解决",
            intent: "INFORMATIONAL",
          },
          {
            text: `目前市面上各家${industry}产品方案优缺点与避坑指南`,
            category: "竞品对比",
            intent: "COMMERCIAL",
          },
        ],
      });
      break;
    }

    case "content_channel_adaptation": {
      const sourceTitle = String(input?.title || "未命名草稿");
      const sourceBody = String(input?.body || "").replace(/\s+/g, " ").trim();
      const requested = Array.isArray(input?.channels) ? input.channels : [];
      mockContent = JSON.stringify({
        channels: requested.map((item: any) => {
          const limits = item?.limits || {};
          const titleMax = Number(limits.title) > 0 ? Number(limits.title) : sourceTitle.length;
          const bodyMax = limits.body == null ? sourceBody.length : Number(limits.body);
          const tagMax = limits.maxTags == null ? 1 : Number(limits.maxTags);
          const hashtags = tagMax > 0 ? ["原文适配"] : [];
          return {
            channel: item.channel,
            title: sourceTitle.slice(0, titleMax),
            body: sourceBody.slice(0, Math.max(0, bodyMax)),
            hashtags,
            videoScript: item.requiresVideo ? `口播沿用原文：${sourceBody.slice(0, 80)}` : "",
            omittedClaims: ["模拟适配只复述原文，不补充事实"],
          };
        }),
      });
      break;
    }

    case "video_script": {
      const topic = input?.topic || "企业GEO优化与AI搜索收录指南";
      const brand = input?.brandName || "品牌方";
      mockContent = JSON.stringify({
        title: `3招让AI大模型主动推荐你！${topic}`,
        hook: `为什么你的同行在DeepSeek和豆包里总被推荐，而你的品牌却查无此人？`,
        scenes: [
          {
            sceneNumber: 1,
            visual: "特写镜头：展示主流大模型对行业选型提问的回答列表",
            narration: "现在客户找供应商，已经直接问AI了！",
            durationSeconds: 6,
          },
          {
            sceneNumber: 2,
            visual: "中景切换：展示GEO诊断大屏与竞品声量分析雷达",
            narration: `要想让AI精准推荐${brand}，关键是打造Answer-First官方回答和高权重第三方信源。`,
            durationSeconds: 15,
          },
          {
            sceneNumber: 3,
            visual: "全景特写：优化后的多模型提及对比与数据跃升",
            narration: "做好GEO布局，AI可见度直接翻倍！",
            durationSeconds: 9,
          },
        ],
        callToAction: "点击左下角或私信，免费领取你所在赛道的AI搜索可见度全景诊断！",
        tags: ["GEO优化", "AI搜索营销", "获客增长", "新媒体运营"],
      });
      break;
    }

    default: {

      mockContent = JSON.stringify({
        message: `AI generation completed for feature: ${feature}`,
        feature,
        timestamp: new Date().toISOString(),
      });
      break;
    }
  }

  return {
    content: mockContent,
    model: modelName,
    actualModel: "mock-ai-engine",
    inputTokens: Math.max(50, Math.round(mockContent.length / 4)),
    outputTokens: Math.max(100, Math.round(mockContent.length / 2)),
    totalTokens: Math.max(150, Math.round((mockContent.length * 3) / 4)),
    estimatedCost: 0,
    requestId: `mock-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  };
}
