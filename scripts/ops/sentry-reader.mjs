#!/usr/bin/env node

import { createSentryReader, loadSentryBridgeConfig } from '../../src/ops/sentry-reader/index.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = rest[index + 1];
    if (value == null || value.startsWith('--')) {
      throw new Error(`Missing value for ${token}`);
    }
    args[key] = value;
    index += 1;
  }

  return { command, args };
}

function printUsage() {
  console.error(`Usage:
  node scripts/ops/sentry-reader.mjs get-issue --issue-id <id>
  node scripts/ops/sentry-reader.mjs get-issue-event --issue-id <id> [--event recommended|latest]
  node scripts/ops/sentry-reader.mjs search-by-request-id --request-id <request_id>
  node scripts/ops/sentry-reader.mjs build-incident-packet --issue-id <id>
  node scripts/ops/sentry-reader.mjs build-incident-packet --request-id <request_id>`);
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help') {
    printUsage();
    return;
  }

  const reader = createSentryReader(loadSentryBridgeConfig());
  let result;

  switch (command) {
    case 'get-issue':
      result = await reader.getIssue(args.issueId);
      break;
    case 'get-issue-event':
      result = await reader.getIssueEvent(args.issueId, args.event || 'recommended');
      break;
    case 'search-by-request-id':
      result = await reader.searchByRequestId(args.requestId);
      break;
    case 'build-incident-packet':
      result = await reader.buildIncidentPacket({
        issueId: args.issueId,
        requestId: args.requestId,
        event: args.event || 'recommended',
      });
      break;
    default:
      throw new Error(`Unknown Sentry reader command: ${command}`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[sentry-reader] ${error?.message || 'Sentry reader failed.'}`);
  process.exit(1);
});
