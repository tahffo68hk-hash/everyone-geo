import { DeepSchema, validateDeepSchema } from './schema-validator';

export const CAPABILITY_SCHEMAS: Record<string, DeepSchema> = {
  // Query Domain
  query_set_generation: {
    type: 'object',
    properties: {
      querySetName: { type: 'string' },
      description: { type: 'string' },
      queries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            category: { type: 'string' },
            intent: { type: 'string', enum: ['INFORMATIONAL', 'COMMERCIAL', 'TRANSACTIONAL', 'NAVIGATIONAL', 'DISCOVERY'] },
            queryType: { type: 'string', enum: ['DISCOVERY', 'BRANDED'] },
            rationale: { type: 'string' },
          },
        },
      },
    },
  },
  query_expansion: {
    type: 'object',
    properties: {
      expandedQueries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            category: { type: 'string' },
            intent: { type: 'string' },
            queryType: { type: 'string' },
            rationale: { type: 'string' },
          },
        },
      },
    },
  },
  query_rewrite: {
    type: 'object',
    properties: {
      originalQuery: { type: 'string' },
      rewrittenQueries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            explanation: { type: 'string' },
            targetIntent: { type: 'string' },
          },
        },
      },
    },
  },
  query_classify: {
    type: 'object',
    properties: {
      intent: { type: 'string' },
      category: { type: 'string' },
      queryType: { type: 'string' },
      confidence: { type: 'number', min: 0, max: 1 },
      rationale: { type: 'string' },
    },
  },

  // Geo Intelligence Domain
  geo_topic_detection: {
    type: 'object',
    properties: {
      coreTopics: { type: 'array', items: { type: 'string' } },
      geoTopics: { type: 'array' },
      entities: { type: 'array' },
      comparisonDimensions: { type: 'array', items: { type: 'string' } },
      decisionDimensions: { type: 'array', items: { type: 'string' } },
    },
  },
  geo_keyword_extraction: {
    type: 'object',
    properties: {
      keywords: { type: 'array' },
    },
  },
  geo_keyword_gap: {
    type: 'object',
    properties: {
      gaps: { type: 'array' },
      disclaimer: { type: 'string' },
    },
  },
  geo_clustering: {
    type: 'object',
    properties: {
      clusters: { type: 'array' },
    },
  },

  // Diagnosis Domain
  diagnosis_explanation: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      explanation: { type: 'string' },
      keyFindings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            point: { type: 'string' },
            impact: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
            reason: { type: 'string' },
          },
        },
      },
      supportingEvidenceIds: { type: 'array', items: { type: 'string' } },
      limitations: { type: 'array', items: { type: 'string' } },
    },
  },

  // Optimization Domain
  recommendation_draft: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      problem: { type: 'string' },
      action: { type: 'string' },
      expectedObservableSignal: { type: 'string' },
      priorityRationale: { type: 'string' },
      dependencies: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
    },
  },
  opportunity_draft: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      objective: { type: 'string' },
      problemStatement: { type: 'string' },
      priorityQueries: { type: 'array', items: { type: 'string' } },
      suggestedContentAngle: { type: 'string' },
      estimatedEffort: { type: 'string' },
    },
  },

  // Strategy Domain
  strategy_draft: {
    type: 'object',
    properties: {
      objective: { type: 'string' },
      priorityQuestions: { type: 'array', items: { type: 'string' } },
      targetAudiences: { type: 'array', items: { type: 'string' } },
      contentDirections: { type: 'array' },
      successObservationPlan: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
    },
  },
  campaign_draft: {
    type: 'object',
    properties: {
      campaignName: { type: 'string' },
      objective: { type: 'string' },
      targetQueries: { type: 'array', items: { type: 'string' } },
      contentPlan: { type: 'array' },
      channelSuggestions: { type: 'array', items: { type: 'string' } },
      milestones: { type: 'array' },
    },
  },

  // Content Domain
  content_brief: {
    type: 'object',
    properties: {
      titleIdeas: { type: 'array', items: { type: 'string' } },
      contentObjective: { type: 'string' },
      targetAudience: { type: 'string' },
      questionsToAnswer: { type: 'array', items: { type: 'string' } },
      keyEntities: { type: 'array', items: { type: 'string' } },
      outline: { type: 'array', items: { type: 'string' } },
      evidenceRequirements: { type: 'array', items: { type: 'string' } },
      citationRequirements: { type: 'array', items: { type: 'string' } },
      cta: { type: 'string' },
    },
  },
  content_titles: {
    type: 'object',
    properties: {
      titles: { type: 'array' },
    },
  },
  content_outline: {
    type: 'object',
    properties: {
      outline: { type: 'array' },
    },
  },
  content_draft: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 2 },
      body: { type: 'string', minLength: 50 },
      summary: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      faqSection: { type: 'array' },
    },
  },
  content_rewrite: {
    type: 'object',
    properties: {
      originalContent: { type: 'string' },
      rewrittenContent: { type: 'string' },
      changeSummary: { type: 'string' },
      diffHighlights: { type: 'array', items: { type: 'string' } },
    },
  },
  content_geo_opt: {
    type: 'object',
    properties: {
      missingQuestions: { type: 'array', items: { type: 'string' } },
      missingEntities: { type: 'array', items: { type: 'string' } },
      missingFacts: { type: 'array', items: { type: 'string' } },
      structuralFeedback: { type: 'array', items: { type: 'string' } },
      suggestedFaq: { type: 'array' },
      optimizedContent: { type: 'string' },
    },
  },
  content_faq: {
    type: 'object',
    properties: {
      faqs: { type: 'array' },
    },
  },
  fact_risk_scan: {
    type: 'object',
    properties: {
      claims: { type: 'array' },
      overallRisk: { type: 'string' },
      suggestions: { type: 'array', items: { type: 'string' } },
    },
  },

  // Competitor Domain
  competitor_candidates: {
    type: 'object',
    properties: {
      candidates: { type: 'array' },
    },
  },

  // Outcome Domain
  outcome_summary: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      majorChanges: { type: 'array', items: { type: 'string' } },
      observedTrends: { type: 'array', items: { type: 'string' } },
      disclaimer: { type: 'string' },
    },
  },
  attribution_explanation: {
    type: 'object',
    properties: {
      explanation: { type: 'string' },
      keyFactors: { type: 'array' },
      confoundingNotes: { type: 'array', items: { type: 'string' } },
      attributionStatusNotice: { type: 'string' },
    },
  },

  // Report Domain
  report_summary: {
    type: 'object',
    properties: {
      executiveSummary: { type: 'string' },
      keyFindings: { type: 'array', items: { type: 'string' } },
      evidenceLimitations: { type: 'array', items: { type: 'string' } },
      recommendedNextSteps: { type: 'array', items: { type: 'string' } },
    },
  },

  // Learning Domain
  learning_summary: {
    type: 'object',
    properties: {
      patternExplanation: { type: 'string' },
      scopeOfApplicability: { type: 'array', items: { type: 'string' } },
      limitations: { type: 'array', items: { type: 'string' } },
      testableHypotheses: { type: 'array', items: { type: 'string' } },
      singleSampleWarning: { type: 'string' },
    },
  },
  learning_actions: {
    type: 'object',
    properties: {
      proposedActions: { type: 'array' },
      disclaimer: { type: 'string' },
    },
  },

  // Brand Intelligence Domain
  brand_resolution: {
    type: 'object',
    properties: {
      brandName: { type: 'string' },
      fullName: { type: 'string' },
      region: { type: 'string' },
      industry: { type: 'string' },
      aliases: { type: 'array', items: { type: 'string' } },
      competitors: { type: 'array', items: { type: 'string' } },
      coreKeywords: { type: 'array', items: { type: 'string' } },
      discoveryQueries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            category: { type: 'string' },
            intent: { type: 'string' },
          },
        },
      },
    },
  },

  content_channel_adaptation: {
    type: 'object',
    properties: {
      channels: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            channel: { type: 'string', minLength: 1 },
            title: { type: 'string' },
            body: { type: 'string' },
            hashtags: { type: 'array', items: { type: 'string' } },
            videoScript: { type: 'string', required: false },
            omittedClaims: { type: 'array', items: { type: 'string' }, required: false },
          },
        },
      },
    },
  },

  // Video Script Domain
  video_script: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      hook: { type: 'string' },
      scenes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sceneNumber: { type: 'number' },
            visual: { type: 'string' },
            narration: { type: 'string' },
            durationSeconds: { type: 'number' },
          },
        },
      },
      callToAction: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
};

export function validateCapabilityOutput(feature: string, data: unknown): { valid: boolean; errors: string[] } {
  const schema = CAPABILITY_SCHEMAS[feature];
  if (!schema) {
    return { valid: true, errors: [] }; // unconstrained feature
  }
  return validateDeepSchema(schema, data);
}
