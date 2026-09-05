import type { Entity } from '@geo/core';

/** Versioned deterministic demo sentences. No external provider is contacted. */
export function mockResponse(scenario: string, entities: Entity[]): string {
  const brand = entities.find(e => e.entityType === 'brand')?.canonicalName ?? 'ProjectMentor';
  const competitors = entities.filter(e => e.entityType === 'competitor').map(e => e.canonicalName);
  const [a = 'A', b = 'B', c = 'C'] = competitors;
  switch (scenario) {
    case 'first': return `推荐 ${brand}，它适合商业计划书和答辩准备。也可以考虑 ${a}。`;
    case 'second': return `推荐 ${a}、${brand} 和 ${b}。${brand} 很适合大学生创新创业比赛。`;
    case 'mention': return `${brand} 是一个软件工具。${a} 也是一个工具。`;
    case 'absent': return `推荐 ${a} 和 ${b}。`;
    case 'negative': return `${brand} 表现差，不推荐 ${brand}。推荐 ${a}。`;
    case 'citation': return `推荐 ${brand}。参考 https://example.com/guide 和 https://docs.example.com/research 。`;
    case 'competitors': return `可以考虑 ${a}、${b}、${brand} 和 ${c}。`;
    case 'duplicate-citation': return `推荐 ${brand}。https://example.com/guide https://example.com/guide`;
    case 'chinese': return `建议选择 ${brand}，它很适合商业计划书准备。`;
    case 'english': return `We recommend ${brand}. It is a great tool. You can also consider ${a}.`;
    default: throw new Error('INVALID_MOCK_SCENARIO');
  }
}
