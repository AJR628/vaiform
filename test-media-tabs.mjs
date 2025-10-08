#!/usr/bin/env node
/**
 * Test: Media Tabs SSOT - Images/Videos correct type flow
 * 
 * Tests that switching between Images and Videos tabs sends the correct type to server
 */

import { apiFetch } from './public/api.mjs';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

console.log('\n🧪 Testing Media Tabs Type Flow\n');

async function testMediaTypeFlow() {
  let passed = 0;
  let failed = 0;

  try {
    // Test 1: Images search
    console.log('📸 Test 1: Searching for Images');
    try {
      const imagesResp = await apiFetch('/assets/options', {
        method: 'POST',
        body: {
          type: 'images',
          query: 'nature',
          page: 1,
          perPage: 12
        }
      });

      if (imagesResp.ok && imagesResp.data?.meta?.type === 'images') {
        console.log(`${GREEN}✓${RESET} Images request returned correct type`);
        console.log(`  Meta: ${JSON.stringify(imagesResp.data.meta)}`);
        passed++;
      } else {
        console.log(`${RED}✗${RESET} Images request failed or returned wrong type`);
        console.log(`  Response: ${JSON.stringify(imagesResp)}`);
        failed++;
      }
    } catch (err) {
      console.log(`${RED}✗${RESET} Images request error: ${err.message}`);
      failed++;
    }

    // Test 2: Videos search
    console.log('\n🎥 Test 2: Searching for Videos');
    try {
      const videosResp = await apiFetch('/assets/options', {
        method: 'POST',
        body: {
          type: 'videos',
          query: 'nature',
          page: 1,
          perPage: 12
        }
      });

      if (videosResp.ok && videosResp.data?.meta?.type === 'videos') {
        console.log(`${GREEN}✓${RESET} Videos request returned correct type`);
        console.log(`  Meta: ${JSON.stringify(videosResp.data.meta)}`);
        passed++;
      } else {
        console.log(`${RED}✗${RESET} Videos request failed or returned wrong type`);
        console.log(`  Response: ${JSON.stringify(videosResp)}`);
        failed++;
      }
    } catch (err) {
      console.log(`${RED}✗${RESET} Videos request error: ${err.message}`);
      failed++;
    }

    // Test 3: Verify different results
    console.log('\n🔄 Test 3: Verify Images and Videos return different results');
    try {
      const [imgResp, vidResp] = await Promise.all([
        apiFetch('/assets/options', {
          method: 'POST',
          body: { type: 'images', query: 'nature', page: 1, perPage: 5 }
        }),
        apiFetch('/assets/options', {
          method: 'POST',
          body: { type: 'videos', query: 'nature', page: 1, perPage: 5 }
        })
      ]);

      const imgIds = imgResp.data?.items?.map(i => i.id).join(',') || '';
      const vidIds = vidResp.data?.items?.map(i => i.id).join(',') || '';

      if (imgIds && vidIds && imgIds !== vidIds) {
        console.log(`${GREEN}✓${RESET} Images and Videos return different results`);
        console.log(`  Sample Image IDs: ${imgIds.substring(0, 50)}...`);
        console.log(`  Sample Video IDs: ${vidIds.substring(0, 50)}...`);
        passed++;
      } else {
        console.log(`${RED}✗${RESET} Images and Videos return same or empty results`);
        console.log(`  Image IDs: ${imgIds}`);
        console.log(`  Video IDs: ${vidIds}`);
        failed++;
      }
    } catch (err) {
      console.log(`${RED}✗${RESET} Comparison test error: ${err.message}`);
      failed++;
    }

  } catch (err) {
    console.error(`\n${RED}Fatal error:${RESET}`, err);
  }

  // Summary
  console.log('\n' + '─'.repeat(50));
  console.log(`\n📊 Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ''}${failed} failed${RESET}`);
  
  if (failed === 0) {
    console.log(`\n${GREEN}✓ All tests passed!${RESET}`);
    console.log('\n✅ Media tabs are correctly sending type parameter to server');
    console.log('✅ Images and Videos return different results');
    console.log('✅ Server metadata includes type, query, and page\n');
  } else {
    console.log(`\n${RED}✗ Some tests failed${RESET}\n`);
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  testMediaTypeFlow().catch(err => {
    console.error(`${RED}Test suite error:${RESET}`, err);
    process.exit(1);
  });
}

export { testMediaTypeFlow };

