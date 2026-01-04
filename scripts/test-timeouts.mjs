// scripts/test-timeouts.mjs
// Deterministic timeout test harness for withAbortTimeout()
// Run: node scripts/test-timeouts.mjs
import http from 'node:http';
import { withAbortTimeout } from '../src/utils/fetch.timeout.js';

const TIMEOUT_MS = 300;
const FAILSAFE_MS = 5000;

// Failsafe timer to prevent hanging test process
const failsafeTimer = setTimeout(() => {
  console.error('❌ FAILSAFE: Test exceeded 5s, forcing exit');
  process.exit(1);
}, FAILSAFE_MS);
failsafeTimer.unref(); // Don't block process exit

const sockets = new Set();
let server = null;
let serverPort = 0;
let failures = [];

function createStallServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url === '/stall-bytes') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '1000000', // Lie about size to force streaming
        });
        res.write(Buffer.alloc(10));
        // Never call res.end() - hangs forever
      } else if (req.url === '/stall-json') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': '1000000', // Lie about size
        });
        res.write('{"ok":');
        // Never call res.end() - hangs forever
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.on('connection', (sock) => {
      sockets.add(sock);
      sock.on('close', () => {
        sockets.delete(sock);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
  });
}

function getBaseUrl() {
  return `http://127.0.0.1:${serverPort}`;
}

async function cleanup() {
  // Destroy all sockets first
  sockets.forEach((sock) => {
    sock.destroy();
  });
  sockets.clear();

  // Close server
  if (server) {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  // Clear failsafe timer
  clearTimeout(failsafeTimer);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name, fn) {
  try {
    const result = await fn();
    const elapsedPart = result || '';
    console.log(`✅ PASS: ${name}${elapsedPart ? ' ' + elapsedPart : ''}`);
  } catch (err) {
    const msg = err.message || String(err);
    console.error(`❌ FAIL: ${name}: ${msg}`);
    failures.push(name);
  }
}

async function main() {
  try {
    // Start server
    await createStallServer();

    // Test 1: Streaming timeout during read (getReader loop)
    console.log('🧪 streaming timeout...');
    await test('IMAGE_DOWNLOAD_TIMEOUT', async () => {
      const start = Date.now();
      let elapsed = 0;
      let error = null;

      try {
        await withAbortTimeout(
          async (signal) => {
            const url = `${getBaseUrl()}/stall-bytes`;
            const res = await fetch(url, { signal });
            const reader = res.body.getReader();

            // This will hang during read - should timeout
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          },
          { timeoutMs: TIMEOUT_MS, errorMessage: 'IMAGE_DOWNLOAD_TIMEOUT' }
        );
        throw new Error('Expected timeout error, but operation completed');
      } catch (err) {
        error = err;
        elapsed = Date.now() - start;
      }

      // Validate error
      assert(error, 'Expected error to be thrown');
      assert(
        error.message === 'IMAGE_DOWNLOAD_TIMEOUT',
        `Wrong error message. Got: "${error.message}", Expected: "IMAGE_DOWNLOAD_TIMEOUT"`
      );
      assert(
        error.code === 'IMAGE_DOWNLOAD_TIMEOUT',
        `Wrong error code. Got: "${error.code}", Expected: "IMAGE_DOWNLOAD_TIMEOUT"`
      );
      assert(
        typeof error.timeoutMs === 'number',
        `Missing timeoutMs property. Got: ${typeof error.timeoutMs}`
      );
      assert(
        error.timeoutMs === TIMEOUT_MS,
        `Wrong timeoutMs. Got: ${error.timeoutMs}, Expected: ${TIMEOUT_MS}`
      );

      // Tolerant timing assertion
      if (elapsed > TIMEOUT_MS + 1500) {
        console.warn(
          `⚠️  WARN: Timeout took ${elapsed}ms (expected ~${TIMEOUT_MS}ms)`
        );
      }

      return `(elapsed ${elapsed}ms)`;
    });

    // Test 2: arrayBuffer timeout
    console.log('🧪 arrayBuffer timeout...');
    await test('TTS_TIMEOUT', async () => {
      const start = Date.now();
      let elapsed = 0;
      let error = null;

      try {
        await withAbortTimeout(
          async (signal) => {
            const url = `${getBaseUrl()}/stall-json`;
            const res = await fetch(url, { signal });
            // This will hang during body consumption - should timeout
            await res.arrayBuffer();
          },
          { timeoutMs: TIMEOUT_MS, errorMessage: 'TTS_TIMEOUT' }
        );
        throw new Error('Expected timeout error, but operation completed');
      } catch (err) {
        error = err;
        elapsed = Date.now() - start;
      }

      // Validate error
      assert(error, 'Expected error to be thrown');
      assert(
        error.message === 'TTS_TIMEOUT',
        `Wrong error message. Got: "${error.message}", Expected: "TTS_TIMEOUT"`
      );
      assert(
        error.code === 'TTS_TIMEOUT',
        `Wrong error code. Got: "${error.code}", Expected: "TTS_TIMEOUT"`
      );
      assert(
        typeof error.timeoutMs === 'number',
        `Missing timeoutMs property. Got: ${typeof error.timeoutMs}`
      );
      assert(
        error.timeoutMs === TIMEOUT_MS,
        `Wrong timeoutMs. Got: ${error.timeoutMs}, Expected: ${TIMEOUT_MS}`
      );

      // Tolerant timing assertion
      if (elapsed > TIMEOUT_MS + 1500) {
        console.warn(
          `⚠️  WARN: Timeout took ${elapsed}ms (expected ~${TIMEOUT_MS}ms)`
        );
      }

      return `(elapsed ${elapsed}ms)`;
    });

    // Final results
    if (failures.length > 0) {
      console.error(`\n❌ ${failures.length} test(s) failed: ${failures.join(', ')}`);
      process.exit(1);
    } else {
      console.log('\n✅ All timeout tests passed');
      process.exit(0);
    }
  } catch (err) {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});

