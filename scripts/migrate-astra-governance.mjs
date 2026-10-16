import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import { prisma } from '../packages/database/src/index.js';

async function main() {
  const astraOrgSlugs = [
    'astra-distribution-qa-owner-的组织',
    'astra-distribution-qa-outsider-的组织',
    'astra-distribution-qa-owner-的组织-tvsf',
    'astra-distribution-qa-outsider-的组织-13kg'
  ];

  const astraOrgs = await prisma.organization.findMany({
    where: {
      OR: [
        { slug: { in: astraOrgSlugs } },
        { name: { contains: 'Astra Distribution QA' } }
      ]
    }
  });

  console.log(`Found ${astraOrgs.length} Astra organizations to clean.`);
  if (astraOrgs.length === 0) {
    console.log('No Astra organizations found. Already cleaned!');
    return;
  }

  const qaOrgIds = astraOrgs.map(o => o.id);

  const remainingProjects = await prisma.project.findMany({
    where: { organizationId: { in: qaOrgIds } },
    select: { id: true, name: true }
  });
  console.log(`Remaining QA projects in Astra orgs: ${remainingProjects.map(p => p.name).join(', ')}`);

  const remainingProjectIds = remainingProjects.map(p => p.id);

  // Clean QA project data in proper topological order
  await prisma.$transaction(async (tx) => {
    // Retest Items & Runs
    await tx.retestItem.deleteMany({
      where: { retestRun: { projectId: { in: remainingProjectIds } } }
    });
    await tx.retestRun.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });

    // Content Publication attempts & publications
    await tx.publicationAttempt.deleteMany({
      where: { publication: { projectId: { in: remainingProjectIds } } }
    });
    await tx.publishedAsset.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.publication.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });

    // Content Draft Revisions & Approvals & Drafts
    await tx.contentRevision.deleteMany({
      where: { draft: { projectId: { in: remainingProjectIds } } }
    });
    await tx.contentApproval.deleteMany({
      where: { draft: { projectId: { in: remainingProjectIds } } }
    });
    await tx.contentDraft.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.contentAsset.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });

    // Audits & Channel connections & Usage events
    await tx.contentUsageEvent.deleteMany({
      where: { organizationId: { in: qaOrgIds } }
    });
    await tx.contentAuditLog.deleteMany({
      where: { organizationId: { in: qaOrgIds } }
    });
    await tx.channelAccountConnection.deleteMany({
      where: { organizationId: { in: qaOrgIds } }
    });

    // Reports, Diagnosis, Recommendations
    await tx.benchmarkReport.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.diagnosisFindingEvidence.deleteMany({
      where: { finding: { run: { projectId: { in: remainingProjectIds } } } }
    });
    await tx.diagnosisFinding.deleteMany({
      where: { run: { projectId: { in: remainingProjectIds } } }
    });
    await tx.diagnosisRun.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.actionItem.deleteMany({
      where: { recommendation: { run: { projectId: { in: remainingProjectIds } } } }
    });
    await tx.recommendationFinding.deleteMany({
      where: { recommendation: { run: { projectId: { in: remainingProjectIds } } } }
    });
    await tx.recommendation.deleteMany({
      where: { run: { projectId: { in: remainingProjectIds } } }
    });
    await tx.recommendationRun.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.contentOpportunityRecommendation.deleteMany({
      where: { opportunity: { run: { projectId: { in: remainingProjectIds } } } }
    });
    await tx.contentOpportunityQuery.deleteMany({
      where: { opportunity: { run: { projectId: { in: remainingProjectIds } } } }
    });
    await tx.contentOpportunityEvidence.deleteMany({
      where: { opportunity: { run: { projectId: { in: remainingProjectIds } } } }
    });
    await tx.contentOpportunityBlock.deleteMany({
      where: { opportunity: { run: { projectId: { in: remainingProjectIds } } } }
    });
    await tx.contentOpportunity.deleteMany({
      where: { run: { projectId: { in: remainingProjectIds } } }
    });
    await tx.contentOpportunityRun.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });

    // Runs & Evidences
    await tx.mention.deleteMany({
      where: { analysis: { evidence: { run: { query: { projectId: { in: remainingProjectIds } } } } } }
    });
    await tx.citation.deleteMany({
      where: { analysis: { evidence: { run: { query: { projectId: { in: remainingProjectIds } } } } } }
    });
    await tx.analysis.deleteMany({
      where: { evidence: { run: { query: { projectId: { in: remainingProjectIds } } } } }
    });
    await tx.competitorCandidateEvidence.deleteMany({
      where: { run: { query: { projectId: { in: remainingProjectIds } } } }
    });
    await tx.evidence.deleteMany({
      where: { run: { query: { projectId: { in: remainingProjectIds } } } }
    });
    await tx.run.deleteMany({
      where: { query: { projectId: { in: remainingProjectIds } } }
    });

    // MonitorTasks & BenchmarkRuns
    await tx.benchmarkRunQuery.deleteMany({
      where: { run: { projectId: { in: remainingProjectIds } } }
    });
    await tx.benchmarkRun.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.monitorTask.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });

    // Queries & Suites & QuerySets
    await tx.query.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.benchmarkQuery.deleteMany({
      where: { suite: { projectId: { in: remainingProjectIds } } }
    });
    await tx.benchmarkSuite.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.querySet.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });

    // Brands & Competitors
    await tx.targetEntityAlias.deleteMany({
      where: { brand: { projectId: { in: remainingProjectIds } } }
    });
    await tx.brand.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.competitorCandidate.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.competitorSetEntry.deleteMany({
      where: { set: { projectId: { in: remainingProjectIds } } }
    });
    await tx.competitorSet.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.competitor.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });
    await tx.aiGeneration.deleteMany({
      where: { projectId: { in: remainingProjectIds } }
    });

    // Finally delete QA projects
    await tx.project.deleteMany({
      where: { id: { in: remainingProjectIds } }
    });

    // Memberships & Organizations
    await tx.organizationMember.deleteMany({
      where: { organizationId: { in: qaOrgIds } }
    });
    await tx.organization.deleteMany({
      where: { id: { in: qaOrgIds } }
    });

    // Delete QA test users
    await tx.user.deleteMany({
      where: { email: { startsWith: 'astra-dist-' } }
    });

    // Delete QA mock engine
    await tx.engine.deleteMany({
      where: { key: 'astra-dist-qa-mock' }
    });
  });

  console.log('Successfully cleaned up obsolete Astra QA test organizations, users, and QA projects.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
