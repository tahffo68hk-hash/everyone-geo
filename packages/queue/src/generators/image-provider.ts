/**
 * GeoLens AI Content Engine V2 - Image Generation Provider
 *
 * 核心能力：
 * 1. 统一接口 ImageGenerationProvider（generateImage, getGenerationStatus）
 * 2. 真实第一 Provider：通义万相（Wanx / DashScope text2image）
 * 3. 安全与隔离：MockImageGenerationProvider 支持全真比例（900:383, 3:4, 1:1, 9:16, 16:9）与文字排版渲染
 * 4. Image Fact Safety 提示词安全清洗：禁止未核实硬件细节（如虚构显示屏/医疗标识等）进入 photorealistic prompt
 */

import { createHash } from 'node:crypto';
import type { VerifiedFact } from './fact-grounding';

export type ImageRatio = '900:383' | '3:4' | '1:1' | '16:9' | '9:16' | string;

export interface ImageGenerationInput {
  prompt: string;
  negativePrompt?: string;
  ratio: ImageRatio;
  style: string;
  referenceAssets?: string[];
  textOverlay?: {
    mainTitle: string;
    subtitle?: string;
    badge?: string;
  };
  draftId?: string;
  variantId?: string;
  knownFacts?: VerifiedFact[];
}

export interface ImageGenerationOutput {
  provider: string;
  model: string;
  jobId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  imageUrl?: string;
  imageBuffer?: Buffer;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  ratio: string;
  metadata: Record<string, unknown>;
}

export interface ImageGenerationProvider {
  readonly providerName: string;
  readonly modelName: string;
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput>;
  getGenerationStatus(jobId: string): Promise<{
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    imageUrl?: string;
  }>;
}

/**
 * Image Fact Safety: 清洗生图 Prompt，防止将不存在的产品特征或医疗认证生成为逼真写实照片
 */
export function sanitizeImagePrompt(prompt: string, knownFacts: VerifiedFact[] = []): {
  safePrompt: string;
  isModified: boolean;
  warnings: string[];
} {
  let safePrompt = prompt;
  const warnings: string[] = [];
  let isModified = false;

  const unsafeFeatures = [
    { pattern: /touchscreen|led display|digital screen|oeld screen|触摸屏|液晶显示屏/gi, replacement: 'modern minimalist sleek panel without screen', desc: '未经证实的产品屏幕特征' },
    { pattern: /medical badge|fda approved|cfda certified|医疗级认证|红十字标识/gi, replacement: 'clean quality aesthetic emblem', desc: '未核实医疗资质或监管标志' },
    { pattern: /veterinary hospital certification|兽医推荐奖牌/gi, replacement: 'warm pet lifestyle scene', desc: '未核实行业奖牌' },
  ];

  for (const item of unsafeFeatures) {
    if (item.pattern.test(safePrompt)) {
      safePrompt = safePrompt.replace(item.pattern, item.replacement);
      warnings.push(`已修正：${item.desc}，降级为概念或场景呈现`);
      isModified = true;
    }
  }

  return { safePrompt, isModified, warnings };
}

export interface WanxSizeMapping {
  providerSize: '1024*1024' | '720*1280' | '1280*720';
  orientation: 'square' | 'portrait' | 'landscape';
  cropMode?: 'FIT_OR_CROP_3_4' | 'FIT_OR_CROP_900_383';
}

export function mapRatioToWanxSize(ratio: ImageRatio): WanxSizeMapping {
  switch (ratio) {
    case '1:1':
      return { providerSize: '1024*1024', orientation: 'square' };
    case '9:16':
      return { providerSize: '720*1280', orientation: 'portrait' };
    case '3:4':
      // 官方 wanx-v1 不支持 768*1024；将 portrait 映射到 720*1280 并附带裁切元数据
      return {
        providerSize: '720*1280',
        orientation: 'portrait',
        cropMode: 'FIT_OR_CROP_3_4',
      };
    case '16:9':
      return { providerSize: '1280*720', orientation: 'landscape' };
    case '900:383':
      // 官方 wanx-v1 不支持 900:383；将 landscape 映射到 1280*720 并附带裁切元数据
      return {
        providerSize: '1280*720',
        orientation: 'landscape',
        cropMode: 'FIT_OR_CROP_900_383',
      };
    default:
      return { providerSize: '1024*1024', orientation: 'square' };
  }
}

/**
 * 通义万相 (Wanx / DashScope) 真实生图 Provider
 */
export class WanxImageGenerationProvider implements ImageGenerationProvider {
  readonly providerName = 'wanx';
  readonly modelName = 'wanx-v1';

  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(apiKey?: string, baseUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis') {
    this.apiKey = apiKey ?? process.env.QWEN_API_KEY ?? null;
    this.baseUrl = baseUrl;
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const { safePrompt, warnings } = sanitizeImagePrompt(input.prompt, input.knownFacts);

    if (!this.apiKey) {
      throw new Error('UNVERIFIED_PROVIDER: 缺少 DashScope API Key (QWEN_API_KEY)');
    }

    // 映射万相官方支持的比例规格（1024*1024, 720*1280, 1280*720）
    const mapping = mapRatioToWanxSize(input.ratio);
    const size = mapping.providerSize;

    const body = {
      model: this.modelName,
      input: {
        prompt: safePrompt,
        negative_prompt: input.negativePrompt ?? 'blurry, distorted, low quality, oversaturated',
      },
      parameters: {
        style: '<auto>',
        size,
        n: 1,
      },
    };

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(`Wanx API 调用失败: ${data.message || res.statusText}`);
    }

    const taskId = data.output?.task_id || `wanx-task-${Date.now()}`;

    return {
      provider: this.providerName,
      model: this.modelName,
      jobId: taskId,
      status: 'RUNNING',
      ratio: input.ratio,
      mimeType: 'image/jpeg',
      sizeBytes: 0,
      checksum: '',
      metadata: {
        taskId,
        safePrompt,
        warnings,
        requestedRatio: input.ratio,
        providerSize: size,
        cropMode: mapping.cropMode,
        dashscopeOutput: data.output,
      },
    };
  }

  async getGenerationStatus(jobId: string): Promise<{
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    imageUrl?: string;
  }> {
    if (!this.apiKey) return { status: 'FAILED' };
    const taskUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${jobId}`;
    const res = await fetch(taskUrl, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) return { status: 'FAILED' };
    const data = (await res.json()) as any;
    const taskStatus = data.output?.task_status;
    if (taskStatus === 'SUCCEEDED') {
      return {
        status: 'COMPLETED',
        imageUrl: data.output?.results?.[0]?.url,
      };
    }
    if (taskStatus === 'FAILED') return { status: 'FAILED' };
    return { status: 'RUNNING' };
  }
}

/**
 * 模拟生图 Provider (Mock Provider)
 * 渲染确定性高保真 SVG/JPEG 图像数据，确保在开发测试及 Mock 环境下能稳定生成、预览并存入 ContentAsset
 */
export class MockImageGenerationProvider implements ImageGenerationProvider {
  readonly providerName = 'mock';
  readonly modelName = 'mock-canvas-engine-v2';

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const { safePrompt, warnings } = sanitizeImagePrompt(input.prompt, input.knownFacts);

    // 根据 ratio 设定画布宽高
    let width = 800;
    let height = 800;
    if (input.ratio === '900:383') {
      width = 900;
      height = 383;
    } else if (input.ratio === '3:4') {
      width = 750;
      height = 1000;
    } else if (input.ratio === '9:16') {
      width = 720;
      height = 1280;
    } else if (input.ratio === '16:9') {
      width = 1280;
      height = 720;
    }

    const mainTitle = input.textOverlay?.mainTitle || 'PawClean 智能洁足机';
    const subtitle = input.textOverlay?.subtitle || '温和微泡循环水流实测';
    const badge = input.textOverlay?.badge || '实测指南';

    const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a" />
          <stop offset="50%" stop-color="#1e293b" />
          <stop offset="100%" stop-color="#0284c7" />
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="40%" r="50%">
          <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" />
      <rect width="100%" height="100%" fill="url(#glow)" />
      <circle cx="${width * 0.5}" cy="${height * 0.45}" r="${Math.min(width, height) * 0.28}" fill="#0ea5e9" opacity="0.15" />
      
      <!-- 标贴 -->
      <g transform="translate(${width * 0.08}, ${height * 0.12})">
        <rect width="120" height="32" rx="16" fill="#f59e0b" />
        <text x="60" y="21" font-size="14" font-family="system-ui, sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle">${badge}</text>
      </g>

      <!-- 主标 -->
      <text x="${width * 0.08}" y="${height * 0.32}" font-size="${Math.min(width * 0.07, 48)}" font-family="system-ui, sans-serif" font-weight="bold" fill="#ffffff">
        ${mainTitle}
      </text>

      <!-- 副标 -->
      <text x="${width * 0.08}" y="${height * 0.42}" font-size="${Math.min(width * 0.04, 24)}" font-family="system-ui, sans-serif" fill="#94a3b8">
        ${subtitle}
      </text>

      <!-- 底部比例与技术水印 -->
      <text x="${width * 0.08}" y="${height * 0.88}" font-size="12" font-family="monospace" fill="#64748b">
        规格：${input.ratio} · 风格：${input.style} · GeoLens AI Content Engine V2
      </text>
    </svg>`;

    const buf = Buffer.from(svg, 'utf-8');
    const checksum = createHash('sha256').update(buf).digest('hex');
    const jobId = `mock-img-${Date.now()}-${checksum.slice(0, 8)}`;
    const dataUri = `data:image/svg+xml;base64,${buf.toString('base64')}`;

    return {
      provider: this.providerName,
      model: this.modelName,
      jobId,
      status: 'COMPLETED',
      imageUrl: dataUri,
      imageBuffer: buf,
      mimeType: 'image/svg+xml',
      sizeBytes: buf.length,
      checksum,
      ratio: input.ratio,
      metadata: {
        safePrompt,
        warnings,
        isMock: true,
        requestedRatio: input.ratio,
        providerSize: `${width}*${height}`,
        width,
        height,
      },
    };
  }

  async getGenerationStatus(jobId: string): Promise<{
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    imageUrl?: string;
  }> {
    return { status: 'COMPLETED' };
  }
}
