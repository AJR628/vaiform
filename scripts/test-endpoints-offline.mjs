#!/usr/bin/env node

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function checkJq() {
  try {
    execSync('jq --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function prettyPrint(json, key) {
  const hasJq = checkJq();
  if (hasJq) {
    try {
      const result = execSync(`echo '${JSON.stringify(json)}' | jq '${key}'`, { encoding: 'utf8' });
      return result.trim();
    } catch {
      return JSON.stringify(json[key], null, 2);
    }
  } else {
    return JSON.stringify(json[key], null, 2);
  }
}

async function verifyFileStructure(name, testFn) {
  log(colors.blue, `\n🔍 Testing ${name}...`);
  try {
    const result = await testFn();
    if (result.success) {
      log(colors.green, `✅ ${name} - PASSED`);
      if (result.data) {
        console.log(prettyPrint(result.data, '.'));
      }
      return true;
    } else {
      log(colors.red, `❌ ${name} - FAILED: ${result.error}`);
      return false;
    }
  } catch (error) {
    log(colors.red, `❌ ${name} - ERROR: ${error.message}`);
    return false;
  }
}

async function main() {
  log(colors.bold, '🚀 Vaiform Endpoints Structure Verification');
  log(colors.yellow, 'Testing file structure and exports without running server\n');

  let allPassed = true;

  // Test 1: Verify quotes schema exports
  await verifyFileStructure('Quotes Schema Exports', async () => {
    const schemaPath = 'src/schemas/quotes.schema.js';
    const content = readFileSync(schemaPath, 'utf8');

    const requiredSchemas = [
      'GenerateQuoteSchema',
      'RemixQuoteSchema',
      'AssetsOptionsSchema',
      'AiImagesSchema',
    ];
    const missing = requiredSchemas.filter((schema) => !content.includes(schema));

    if (missing.length === 0) {
      return {
        success: true,
        data: { message: 'All required schemas found', schemas: requiredSchemas },
      };
    } else {
      return { success: false, error: `Missing schemas: ${missing.join(', ')}` };
    }
  });

  // Test 2: Verify quotes controller exports
  await verifyFileStructure('Quotes Controller Exports', async () => {
    const controllerPath = 'src/controllers/quotes.controller.js';
    const content = readFileSync(controllerPath, 'utf8');

    const requiredFunctions = ['generateQuote', 'remixQuote'];
    const missing = requiredFunctions.filter(
      (func) => !content.includes(`export async function ${func}`)
    );

    if (missing.length === 0) {
      return {
        success: true,
        data: { message: 'All required functions found', functions: requiredFunctions },
      };
    } else {
      return { success: false, error: `Missing functions: ${missing.join(', ')}` };
    }
  });

  // Test 3: Verify assets controller exports
  await verifyFileStructure('Assets Controller Exports', async () => {
    const controllerPath = 'src/controllers/assets.controller.js';
    const content = readFileSync(controllerPath, 'utf8');

    const requiredFunctions = ['getAssetsOptions', 'generateAiImages'];
    const missing = requiredFunctions.filter(
      (func) => !content.includes(`export async function ${func}`)
    );

    if (missing.length === 0) {
      return {
        success: true,
        data: { message: 'All required functions found', functions: requiredFunctions },
      };
    } else {
      return { success: false, error: `Missing functions: ${missing.join(', ')}` };
    }
  });

  // Test 4: Verify limits controller exports
  await verifyFileStructure('Limits Controller Exports', async () => {
    const controllerPath = 'src/controllers/limits.controller.js';
    const content = readFileSync(controllerPath, 'utf8');

    const requiredFunctions = ['getUsageLimits'];
    const missing = requiredFunctions.filter(
      (func) => !content.includes(`export async function ${func}`)
    );

    if (missing.length === 0) {
      return {
        success: true,
        data: { message: 'All required functions found', functions: requiredFunctions },
      };
    } else {
      return { success: false, error: `Missing functions: ${missing.join(', ')}` };
    }
  });

  // Test 5: Verify planGuard middleware exports
  await verifyFileStructure('PlanGuard Middleware Exports', async () => {
    const middlewarePath = 'src/middleware/planGuard.js';
    const content = readFileSync(middlewarePath, 'utf8');

    const requiredExports = ['export function planGuard', 'export default planGuard'];
    const hasExport = requiredExports.some((exp) => content.includes(exp));

    if (hasExport) {
      return { success: true, data: { message: 'PlanGuard middleware exported correctly' } };
    } else {
      return { success: false, error: 'PlanGuard middleware not properly exported' };
    }
  });

  // Test 6: Verify routes are properly configured
  await verifyFileStructure('Routes Configuration', async () => {
    const routesIndexPath = 'src/routes/index.js';
    const appPath = 'src/app.js';

    const routesContent = readFileSync(routesIndexPath, 'utf8');
    const appContent = readFileSync(appPath, 'utf8');

    const requiredRoutes = ['quotes', 'assets', 'limits'];
    const missingInIndex = requiredRoutes.filter(
      (route) => !routesContent.includes(`${route}Router`)
    );
    const missingInApp = requiredRoutes.filter((route) => !appContent.includes(`routes.${route}`));

    if (missingInIndex.length === 0 && missingInApp.length === 0) {
      return {
        success: true,
        data: { message: 'All routes properly configured', routes: requiredRoutes },
      };
    } else {
      return {
        success: false,
        error: `Missing routes - Index: ${missingInIndex.join(', ')}, App: ${missingInApp.join(', ')}`,
      };
    }
  });

  // Test 7: Verify API envelope structure in controllers
  await verifyFileStructure('API Envelope Structure', async () => {
    const controllerPaths = [
      'src/controllers/quotes.controller.js',
      'src/controllers/assets.controller.js',
      'src/controllers/limits.controller.js',
    ];

    let allHaveEnvelope = true;
    let missingEnvelopes = [];

    for (const path of controllerPaths) {
      const content = readFileSync(path, 'utf8');
      if (!content.includes('{ ok: true') && !content.includes('{ ok: false')) {
        allHaveEnvelope = false;
        missingEnvelopes.push(path);
      }
    }

    if (allHaveEnvelope) {
      return { success: true, data: { message: 'All controllers use proper API envelope' } };
    } else {
      return {
        success: false,
        error: `Controllers missing envelope: ${missingEnvelopes.join(', ')}`,
      };
    }
  });

  // Test 8: Verify payload validation schemas
  await verifyFileStructure('Payload Validation Schemas', async () => {
    const schemaPath = 'src/schemas/quotes.schema.js';
    const content = readFileSync(schemaPath, 'utf8');

    const requiredFields = {
      GenerateQuoteSchema: ['text', 'tone', 'maxChars'],
      RemixQuoteSchema: ['originalText', 'mode', 'targetTone', 'maxChars'],
      AssetsOptionsSchema: ['type', 'query', 'page', 'perPage'],
      AiImagesSchema: ['prompt', 'style', 'count'],
    };

    let allSchemasValid = true;
    let invalidSchemas = [];

    for (const [schemaName, fields] of Object.entries(requiredFields)) {
      const missingFields = fields.filter((field) => !content.includes(field));
      if (missingFields.length > 0) {
        allSchemasValid = false;
        invalidSchemas.push(`${schemaName}: missing ${missingFields.join(', ')}`);
      }
    }

    if (allSchemasValid) {
      return {
        success: true,
        data: { message: 'All schemas have required fields', schemas: Object.keys(requiredFields) },
      };
    } else {
      return { success: false, error: `Invalid schemas: ${invalidSchemas.join('; ')}` };
    }
  });

  // Summary
  log(colors.bold, '\n📊 Verification Summary');
  if (allPassed) {
    log(colors.green, '🎉 All endpoint structure verifications completed!');
    log(colors.yellow, '\n📝 Next steps:');
    log(colors.yellow, '1. Set OPENAI_API_KEY environment variable');
    log(colors.yellow, '2. Start server with: npm start');
    log(colors.yellow, '3. Run full endpoint tests with: node scripts/verify-endpoints.mjs');
    process.exit(0);
  } else {
    log(colors.red, '💥 Some verifications failed!');
    process.exit(1);
  }
}

main().catch((error) => {
  log(colors.red, `Script failed: ${error.message}`);
  process.exit(1);
});
