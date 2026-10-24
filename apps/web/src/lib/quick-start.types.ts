export type AiProvider = "MOCK" | "DEEPSEEK" | "QWEN";

export type QuickStartStage =
  | "BRAND"
  | "QUESTIONS"
  | "MONITOR"
  | "REPORT"
  | "CONTENT"
  | "DISTRIBUTION";

export type QuestionKind = "DISCOVERY" | "BRANDED";

export type QuestionDraft = {
  queryId?: string;
  text: string;
  kind: QuestionKind;
  intent: string;
};

export type ProviderStatus = {
  provider: AiProvider;
  model: string;
  configured: boolean;
  label: string;
};

export type QuickStartRun = {
  id: string;
  status: "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
  provider: AiProvider;
  model: string;
  isMock: boolean;
  requestCount: number;
  responseCount: number;
  error?: string | null;
  responses: Array<{
    id: string;
    queryId: string | null;
    queryText: string;
    kind: QuestionKind;
    intent: string;
    rawPrompt: string;
    rawResponse: string;
    brandMentioned: boolean;
    mentionPosition: number | null;
    competitorMentions: string[];
    citations: string[];
    isMock: boolean;
    latencyMs: number;
  }>;
  report?: QuickStartReport | null;
};

export type QuickStartReport = {
  id: string;
  containsMockData: boolean;
  metrics: {
    total: number;
    mentioned: number;
    rate: number | null;
    discovery: { total: number; mentioned: number; rate: number | null };
    branded: { total: number; mentioned: number; rate: number | null };
    competitors: Record<string, number>;
    retrieval?: {
      total: number;
      withSources: number;
      sourceCount: number;
      rate: number | null;
    };
    sampleNote?: string;
  };
  run?: { provider: AiProvider; model: string; responses: QuickStartRun["responses"] };
  suggestions: Array<{
    id: string;
    title: string;
    action: string;
    isMock: boolean;
    evidenceMock: boolean;
    evidence: Array<{ response: { id: string; queryText: string; rawResponse: string; isMock: boolean } }>;
  }>;
  contentAssets: ContentAsset[];
};

export type ContentAsset = {
  id: string;
  channel: string;
  title: string;
  body: string;
  hashtags: string[];
  metadata: Record<string, unknown> | null;
  status: "DRAFT" | "SAVED";
  isMock: boolean;
  evidenceMock: boolean;
  generations: Array<{
    provider: AiProvider;
    model: string;
    promptVersion: string;
    isMock: boolean;
    evidenceMock: boolean;
    tokens?: unknown;
    costEstimate?: number | null;
  }>;
  distributionTasks: Array<{ id: string; platform: string; status: string }>;
};

export type QuickStartSession = {
  id: string;
  projectId: string;
  brandId: string;
  currentStep: QuickStartStage;
  provider: AiProvider;
  model: string;
  questions: QuestionDraft[];
  questionGeneration: {
    isMock?: boolean;
    provider?: AiProvider;
    model?: string;
  } | null;
  project: {
    id: string;
    name: string;
    organizationId: string;
    industry: string | null;
    competitors: Array<{ id: string; name: string }>;
  };
  brand: {
    id: string;
    name: string;
    website: string | null;
  };
  runs: QuickStartRun[];
};

export type DistributionTask = {
  id: string;
  platform: string;
  platformLabel: string;
  status: "DRAFT" | "NEEDS_HUMAN_REVIEW";
  note: string;
  project: { id: string; name: string };
  content: {
    id: string;
    title: string;
    body: string;
    channel: string;
    status: "DRAFT" | "SAVED";
    isMock: boolean;
    evidenceMock: boolean;
    hashtags: string[];
    metadata?: Record<string, unknown> | null;
    brand: { name: string };
  };
};
