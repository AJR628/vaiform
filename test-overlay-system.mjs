#!/usr/bin/env node

/**
 * Test script for the new draggable caption overlay system
 * Tests the complete flow from overlay meta to server render
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';

// Test payload for the new overlay system
const testPayload = {
  text: 'Stay patient. It will click.',
  yPct: 0.65,
  xPct: 0.1,
  wPct: 0.8,
  fontFamily: 'DejaVu Sans',
  weightCss: '800',
  sizePx: 38,
  color: 'rgb(255,255,255)',
  opacity: 1,
  textAlign: 'center',
  padding: 12,
  placement: 'custom',
};

async function testPreview() {
  console.log('🧪 Testing caption preview...');

  try {
    const response = await fetch(`${BASE_URL}/api/caption/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Preview failed: ${response.status} ${error}`);
    }

    const result = await response.json();
    console.log('✅ Preview test passed');
    console.log('📊 Result:', {
      hasPreviewUrl: !!result.previewUrl,
      hasMeta: !!result.meta,
      yPct: result.meta?.yPct,
    });

    return result;
  } catch (error) {
    console.error('❌ Preview test failed:', error.message);
    throw error;
  }
}

async function testRender() {
  console.log('🧪 Testing caption render...');

  try {
    const response = await fetch(`${BASE_URL}/api/caption/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Render failed: ${response.status} ${error}`);
    }

    const result = await response.json();
    console.log('✅ Render test passed');
    console.log('📊 Result:', {
      success: result.success,
      hasJobId: !!result.jobId,
      hasOutputUrl: !!result.outputUrl,
      hasMeta: !!result.meta,
    });

    return result;
  } catch (error) {
    console.error('❌ Render test failed:', error.message);
    throw error;
  }
}

async function testLegacyFormat() {
  console.log('🧪 Testing legacy format compatibility...');

  const legacyPayload = {
    style: {
      text: 'Legacy format test',
      fontFamily: 'DejaVu Sans Local',
      weight: 'bold',
      fontPx: 48,
      placement: 'center',
    },
  };

  try {
    const response = await fetch(`${BASE_URL}/api/caption/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(legacyPayload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Legacy test failed: ${response.status} ${error}`);
    }

    const result = await response.json();
    console.log('✅ Legacy format test passed');
    console.log('📊 Result:', {
      ok: result.ok,
      hasDataUrl: !!result.data?.imageUrl,
    });

    return result;
  } catch (error) {
    console.error('❌ Legacy format test failed:', error.message);
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting overlay system tests...\n');

  try {
    // Test 1: New overlay format preview
    await testPreview();
    console.log('');

    // Test 2: New overlay format render
    await testRender();
    console.log('');

    // Test 3: Legacy format compatibility
    await testLegacyFormat();
    console.log('');

    console.log('🎉 All tests passed! The draggable caption overlay system is working correctly.');
  } catch (error) {
    console.error('💥 Test suite failed:', error.message);
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
