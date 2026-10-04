#!/usr/bin/env node
// Lightweight repository truth validation
// Checks that documentation references match actual workspace structure

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
let errors = 0;

function check(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    errors++;
  } else {
    console.log(`✅ ${message}`);
  }
}

// Check workspace packages exist
const workspacePackages = [
  ['packages/database', '@geo/database'],
  ['packages/geo-core', '@geo/core'],
  ['packages/llm', '@geo/llm'],
  ['packages/queue', '@geo/queue'],
  ['apps/api', '@geolens/api'],
  ['apps/web', '@geolens/web'],
  ['apps/worker', '@geolens/worker'],
];

for (const [dir, name] of workspacePackages) {
  const pkgPath = join(root, dir, 'package.json');
  check(existsSync(pkgPath), `Package ${name} exists at ${dir}`);
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    check(pkg.name === name, `Package at ${dir} has name ${name} (actual: ${pkg.name})`);
  }
}

// Check non-existent packages are not referenced
const phantomDirs = ['packages/shared', 'packages/ui', 'packages/config'];
for (const dir of phantomDirs) {
  check(!existsSync(join(root, dir)), `Phantom package ${dir} does not exist (expected)`);
}

// Check key config files exist
const requiredFiles = ['pnpm-workspace.yaml', 'docker-compose.yml', '.env.example'];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), `Required file ${file} exists`);
}

// Check Prisma schema exists
check(existsSync(join(root, 'packages/database/prisma/schema.prisma')), 'Prisma schema exists');

console.log(`\n${errors === 0 ? '✅ All checks passed' : `❌ ${errors} check(s) failed`}`);
process.exit(errors > 0 ? 1 : 0);
