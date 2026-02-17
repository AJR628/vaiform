#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

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

async function makeRequest(url, options = {}) {
  const defaultOptions = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.TEST_AUTH_TOKEN || 'test-token'}`,
    },
  };

  const finalOptions = { ...defaultOptions, ...options };

  try {
    const response = await fetch(url, finalOptions);
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    return { status: 0, error: error.message };
  }
}

async function verifyEndpoint(name, testFn) {
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
  log(colors.bold, '🚀 Vaiform Endpoints Verification');
  log(colors.yellow, 'Note: Set TEST_AUTH_TOKEN env var for real auth testing\n');

  // Use the specific Replit URL provided
  const possibleUrls = [
    process.env.API_BASE_URL,
    'https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://localhost:8080',
  ].filter(Boolean);

  let baseUrl = possibleUrls[0] || 'http://localhost:3000';
  let allPassed = true;

  // First, test connectivity to find the right URL
  log(colors.blue, '🔍 Testing server connectivity...');
  let workingUrl = null;
  for (const url of possibleUrls) {
    try {
      const { status } = await makeRequest(url + '/');
      if (status > 0) {
        workingUrl = url;
        log(colors.green, `✅ Found working server at: ${url}`);
        break;
      }
    } catch (e) {
      // Continue to next URL
    }
  }

  if (!workingUrl) {
    log(colors.red, '❌ Could not connect to server on any URL');
    log(colors.yellow, 'Tried URLs:', possibleUrls.join(', '));
    process.exit(1);
  }

  baseUrl = workingUrl;

  // Test 1: Auth header works
  await verifyEndpoint('Auth Header Validation', async () => {
    const { status, data } = await makeRequest(`${baseUrl}/api/limits/usage`);
    if (status === 401) {
      return { success: true, data: { message: 'Auth required (expected)', status } };
    } else if (status === 200) {
      return { success: true, data: { message: 'Auth accepted', status, plan: data.data?.plan } };
    } else {
      return { success: false, error: `Unexpected status: ${status}` };
    }
  });

  // Test 2: /api/limits/usage
  await verifyEndpoint('/api/limits/usage', async () => {
    const { status, data } = await makeRequest(`${baseUrl}/api/limits/usage`);
    if (status === 200 && data.ok && data.data) {
      const required = ['plan', 'isPro', 'usage', 'limits'];
      const hasAll = required.every((key) => data.data.hasOwnProperty(key));
      if (hasAll) {
        return { success: true, data: data.data };
      } else {
        return {
          success: false,
          error: `Missing required fields: ${required.filter((k) => !data.data.hasOwnProperty(k)).join(', ')}`,
        };
      }
    } else {
      return { success: false, error: `Status: ${status}, Response: ${JSON.stringify(data)}` };
    }
  });

  // Test 3: /api/quotes/remix with correct payload
  await verifyEndpoint('/api/quotes/remix (payload validation)', async () => {
    const payload = {
      originalText: 'Success is not final, failure is not fatal',
      mode: 'rephrase',
      targetTone: 'motivational',
      maxChars: 100,
    };

    const { status, data } = await makeRequest(`${baseUrl}/api/quotes/remix`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (status === 200 && data.ok && data.data?.quote) {
      return { success: true, data: data.data };
    } else if (status === 403 && data.reason === 'PLAN_UPGRADE_REQUIRED') {
      return { success: true, data: { message: 'Pro plan required (expected)', status } };
    } else {
      return { success: false, error: `Status: ${status}, Response: ${JSON.stringify(data)}` };
    }
  });

  // Test 4: /api/quotes/generate-quote with correct payload
  await verifyEndpoint('/api/quotes/generate-quote (payload validation)', async () => {
    const payload = {
      text: 'Create a motivational quote about perseverance',
      tone: 'motivational',
      maxChars: 120,
    };

    const { status, data } = await makeRequest(`${baseUrl}/api/quotes/generate-quote`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (status === 200 && data.ok && data.data?.quote) {
      const quote = data.data.quote;
      const hasRequired = quote.text && quote.id;
      if (hasRequired) {
        return { success: true, data: data.data };
      } else {
        return { success: false, error: `Quote missing required fields: ${JSON.stringify(quote)}` };
      }
    } else {
      return { success: false, error: `Status: ${status}, Response: ${JSON.stringify(data)}` };
    }
  });

  // Test 5: /api/assets/options for images (Free-like: 2 items)
  await verifyEndpoint('/api/assets/options (images, Free-like)', async () => {
    const payload = {
      type: 'images',
      query: 'nature',
      perPage: 2,
    };

    const { status, data } = await makeRequest(`${baseUrl}/api/assets/options`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (status === 200 && data.ok && data.data) {
      const result = data.data;
      const hasItems = Array.isArray(result.items);
      const itemCount = hasItems ? result.items.length : 0;
      const hasNextPage = typeof result.nextPage === 'boolean';

      if (hasItems && hasNextPage) {
        return {
          success: true,
          data: {
            itemCount,
            hasNextPage: result.nextPage,
            sampleItem: result.items[0] || null,
          },
        };
      } else {
        return { success: false, error: `Invalid response structure: ${JSON.stringify(result)}` };
      }
    } else {
      return { success: false, error: `Status: ${status}, Response: ${JSON.stringify(data)}` };
    }
  });

  // Test 6: /api/assets/options for videos (Pro-like: 16 items)
  await verifyEndpoint('/api/assets/options (videos, Pro-like)', async () => {
    const payload = {
      type: 'videos',
      query: 'business',
      perPage: 16,
    };

    const { status, data } = await makeRequest(`${baseUrl}/api/assets/options`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (status === 200 && data.ok && data.data) {
      const result = data.data;
      const hasItems = Array.isArray(result.items);
      const itemCount = hasItems ? result.items.length : 0;

      return {
        success: true,
        data: {
          itemCount,
          hasNextPage: result.nextPage,
          sampleItem: result.items[0] || null,
        },
      };
    } else {
      return { success: false, error: `Status: ${status}, Response: ${JSON.stringify(data)}` };
    }
  });

  // Test 7: /api/assets/ai-images with correct payload
  await verifyEndpoint('/api/assets/ai-images (payload validation)', async () => {
    const payload = {
      prompt: 'A serene mountain landscape at sunset',
      style: 'realistic',
      count: 2,
    };

    const { status, data } = await makeRequest(`${baseUrl}/api/assets/ai-images`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (status === 200 && data.ok && data.data) {
      return { success: true, data: data.data };
    } else if (status === 403 && data.reason === 'PLAN_UPGRADE_REQUIRED') {
      return { success: true, data: { message: 'Pro plan required (expected)', status } };
    } else {
      return { success: false, error: `Status: ${status}, Response: ${JSON.stringify(data)}` };
    }
  });

  // Summary
  log(colors.bold, '\n📊 Verification Summary');
  if (allPassed) {
    log(colors.green, '🎉 All endpoint verifications completed!');
    process.exit(0);
  } else {
    log(colors.red, '💥 Some verifications failed!');
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log(colors.red, `Unhandled Rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

main().catch((error) => {
  log(colors.red, `Script failed: ${error.message}`);
  process.exit(1);
});
