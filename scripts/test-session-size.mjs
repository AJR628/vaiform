#!/usr/bin/env node
/**
 * Test script for session size limit enforcement
 * Verifies that saveJSON() correctly rejects oversized sessions
 */

import { saveJSON } from '../src/utils/json.store.js';
import assert from 'node:assert';

const TEST_UID = 'test-uid-session-size';
const TEST_STUDIO_ID = 'test-studio-session-size';

// Helper to create a candidate object (typical size)
function createCandidate(id) {
  return {
    id: `candidate-${id}`,
    url: 'https://example.com/video.mp4',
    thumbUrl: 'https://example.com/thumb.jpg',
    duration: 8.5,
    width: 1080,
    height: 1920,
    photographer: 'Test Photographer',
    sourceUrl: 'https://example.com/source',
    provider: 'pexels',
    providerId: `pexels-${id}`,
    license: 'free',
    description: 'Test video description for candidate',
    tags: ['test', 'video', 'stock']
  };
}

// Helper to create an oversized candidate with controlled payload
function createOversizedCandidate(id) {
  const candidate = createCandidate(id);
  // Add _payload field with ~200 bytes per candidate to guarantee exceeding 500KB
  // 8 shots × 150 candidates × 200 bytes = 240KB extra, ensuring we exceed 500KB
  candidate._payload = 'x'.repeat(200);
  return candidate;
}

// Helper to create a shot with candidates
function createShot(sentenceIndex, candidateCount, oversized = false) {
  const candidateFactory = oversized ? createOversizedCandidate : createCandidate;
  return {
    sentenceIndex,
    candidates: Array.from({ length: candidateCount }, (_, i) => candidateFactory(i)),
    selectedClip: candidateFactory(0),
    searchQuery: 'test query',
    durationSec: 8,
    visualDescription: 'Test visual description',
    startTimeSec: sentenceIndex * 8
  };
}

async function testNormalSession() {
  console.log('Test 1: Normal session (should pass)');
  
  // Create session with 8 shots, 12 candidates each (typical usage)
  const normalSession = {
    id: 'test-session-normal',
    uid: TEST_UID,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    story: {
      sentences: Array.from({ length: 8 }, (_, i) => `Sentence ${i + 1}`)
    },
    shots: Array.from({ length: 8 }, (_, i) => createShot(i, 12)),
    plan: {
      shots: Array.from({ length: 8 }, (_, i) => ({ index: i, description: `Plan ${i}` }))
    }
  };
  
  try {
    await saveJSON({ 
      uid: TEST_UID, 
      studioId: TEST_STUDIO_ID, 
      file: 'story.json', 
      data: normalSession 
    });
    console.log('✅ Normal session saved successfully');
    return true;
  } catch (err) {
    console.error('❌ Normal session failed to save:', err.message);
    throw err;
  }
}

async function testOversizedSession() {
  console.log('\nTest 2: Oversized session (should fail)');
  
  // Create session with 8 shots, 150 candidates each with _payload to guarantee exceeding 500KB
  // Base: ~300KB (8 shots × 150 candidates × ~250 bytes base)
  // Payload: ~240KB (8 shots × 150 candidates × 200 bytes _payload)
  // Total: ~540KB (exceeds 500KB limit)
  const oversizedSession = {
    id: 'test-session-oversized',
    uid: TEST_UID,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    story: {
      sentences: Array.from({ length: 8 }, (_, i) => `Sentence ${i + 1}`)
    },
    shots: Array.from({ length: 8 }, (_, i) => createShot(i, 150, true)), // oversized = true
    plan: {
      shots: Array.from({ length: 8 }, (_, i) => ({ index: i, description: `Plan ${i}` }))
    }
  };
  
  // Diagnostic: Check actual size before save attempt
  const json = JSON.stringify(oversizedSession);
  const sizeBytes = Buffer.byteLength(json, 'utf8');
  const sizeKB = (sizeBytes / 1024).toFixed(2);
  const maxKB = (500 * 1024 / 1024).toFixed(2);
  console.log(`   Diagnostic: Session size = ${sizeKB}KB (limit: ${maxKB}KB)`);
  
  try {
    await saveJSON({ 
      uid: TEST_UID, 
      studioId: TEST_STUDIO_ID, 
      file: 'story.json', 
      data: oversizedSession 
    });
    console.error(`   ⚠️  Session saved but should have been rejected (size ${sizeKB}KB)`);
    throw new Error('Should have thrown SESSION_TOO_LARGE');
  } catch (err) {
    if (err.message === 'SESSION_TOO_LARGE') {
      assert.strictEqual(err.code, 'SESSION_TOO_LARGE', 'Error code should be SESSION_TOO_LARGE');
      assert(typeof err.sizeBytes === 'number', 'sizeBytes should be a number');
      assert(typeof err.maxBytes === 'number', 'maxBytes should be a number');
      assert(err.sizeBytes > err.maxBytes, 'sizeBytes should exceed maxBytes');
      assert.strictEqual(err.maxBytes, 500 * 1024, 'maxBytes should be 500KB');
      
      const errSizeKB = (err.sizeBytes / 1024).toFixed(2);
      const errMaxKB = (err.maxBytes / 1024).toFixed(2);
      console.log(`✅ Oversized session correctly rejected`);
      console.log(`   Size: ${errSizeKB}KB (exceeds ${errMaxKB}KB limit)`);
      return true;
    } else {
      console.error('❌ Unexpected error:', err.message);
      throw err;
    }
  }
}

async function main() {
  console.log('=== Session Size Limit Tests ===\n');
  
  try {
    await testNormalSession();
    await testOversizedSession();
    
    console.log('\n✅ All tests passed');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  }
}

main();

