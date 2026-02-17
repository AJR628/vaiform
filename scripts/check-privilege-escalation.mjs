#!/usr/bin/env node
/**
 * Regression guard: Ensure privilege escalation endpoints are not mounted
 *
 * This script fails if any of the following dangerous patterns are found:
 * - Route mounts for /credits/balance or /credits/grant
 * - Function definitions for balance() or grant() in credits controller
 * - Any imports of balance/grant functions
 *
 * Exit code: 0 if safe, 1 if vulnerabilities detected
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const DANGEROUS_PATTERNS = [
  // Route mounts
  /\/credits\/balance/,
  /\/credits\/grant/,
  /router\.(get|post)\(['"]\/balance/,
  /router\.(get|post)\(['"]\/grant/,
  // Function definitions
  /export\s+(async\s+)?function\s+balance\s*\(/,
  /export\s+(async\s+)?function\s+grant\s*\(/,
  // Imports
  /import.*\b(balance|grant)\b.*from.*credits\.controller/,
];

const SAFE_PATTERNS = [
  // Allow in comments (but we should still flag for cleanup)
  /\/\/.*balance/,
  /\/\/.*grant/,
  // Allow in webhook (different function name)
  /grantCreditsAndUpdatePlan/,
  // Allow in error messages/logs
  /credits granted/,
  /Failed to grant/,
];

function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const issues = [];

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(line)) {
        // Check if it's in a safe context (comment, etc.)
        const isSafe = SAFE_PATTERNS.some((safe) => safe.test(line));
        if (!isSafe) {
          issues.push({
            file: filePath,
            line: lineNum,
            content: line.trim(),
            pattern: pattern.toString(),
          });
        }
      }
    }
  });

  return issues;
}

function scanDirectory(dir, extensions = ['.js', '.mjs', '.ts']) {
  const issues = [];

  function walk(currentPath) {
    const entries = readdirSync(currentPath);

    for (const entry of entries) {
      // Skip node_modules, .git, etc.
      if (entry.startsWith('.') || entry === 'node_modules') {
        continue;
      }

      const fullPath = join(currentPath, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const ext = entry.substring(entry.lastIndexOf('.'));
        if (extensions.includes(ext)) {
          const fileIssues = scanFile(fullPath);
          issues.push(...fileIssues);
        }
      }
    }
  }

  walk(dir);
  return issues;
}

// Main execution
const srcDir = join(process.cwd(), 'src');
const issues = scanDirectory(srcDir);

if (issues.length > 0) {
  console.error('❌ PRIVILEGE ESCALATION RISK DETECTED\n');
  console.error('The following dangerous patterns were found:\n');

  issues.forEach((issue) => {
    console.error(`  ${issue.file}:${issue.line}`);
    console.error(`    ${issue.content}`);
    console.error(`    Pattern: ${issue.pattern}\n`);
  });

  console.error(
    'These endpoints must NEVER be mounted without proper authentication and authorization.'
  );
  console.error(
    'If you need admin functionality, create separate admin-only routes with role checks.\n'
  );
  process.exit(1);
} else {
  console.log('✅ No privilege escalation risks detected');
  process.exit(0);
}
