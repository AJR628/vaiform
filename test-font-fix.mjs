#!/usr/bin/env node

/**
 * Test script to verify font loading and server rewrap functionality
 * Run with: node test-font-fix.mjs
 */

import fetch from 'node-fetch';

const BACKEND_URL =
  'https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev';

async function testFontLoading() {
  console.log('🧪 Testing font loading...');

  const fontUrls = [
    '/assets/fonts/DejaVuSans.ttf',
    '/assets/fonts/DejaVuSans-Bold.ttf',
    '/assets/fonts/DejaVuSans-Oblique.ttf',
    '/assets/fonts/DejaVuSans-BoldOblique.ttf',
  ];

  for (const fontUrl of fontUrls) {
    try {
      const response = await fetch(`${BACKEND_URL}${fontUrl}`);
      const contentType = response.headers.get('content-type');
      const contentLength = response.headers.get('content-length');

      console.log(`✅ ${fontUrl}:`);
      console.log(`   Status: ${response.status}`);
      console.log(`   Content-Type: ${contentType}`);
      console.log(`   Content-Length: ${contentLength}`);

      if (response.status !== 200) {
        console.error(`❌ Font failed to load: ${fontUrl}`);
        return false;
      }

      if (!contentType?.includes('font') && !contentType?.includes('application/octet-stream')) {
        console.error(`❌ Wrong content type for font: ${contentType}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error loading font ${fontUrl}:`, error.message);
      return false;
    }
  }

  return true;
}

async function testServerRewrap() {
  console.log('\n🧪 Testing server rewrap functionality...');

  const testPayload = {
    ssotVersion: 3,
    mode: 'raster',
    text: 'Create a motivational quote about success',
    fontPx: 174,
    lineSpacingPx: 174,
    letterSpacingPx: 0,
    rasterW: 1051,
    rasterH: 1218,
    yPx_png: 24,
    rasterPadding: 36,
    xExpr_png: '(W-overlay_w)/2',
    frameW: 1080,
    frameH: 1920,
    lines: ['Create a', 'motivational', 'quote about', 'success'], // These should overflow
    totalTextH: 1218,
    yPxFirstLine: 60,
    fontFamily: 'DejaVu Sans',
    weightCss: '700',
    fontStyle: 'italic',
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.8)',
    opacity: 0.8,
    strokePx: 0,
    strokeColor: 'rgba(0,0,0,0.85)',
    shadowColor: 'rgba(0,0,0,0.6)',
    shadowBlur: 12,
    shadowOffsetX: 0,
    shadowOffsetY: 2,
  };

  try {
    const response = await fetch(`${BACKEND_URL}/api/caption/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload),
    });

    const result = await response.json();

    console.log(`✅ Caption preview response: ${response.status}`);
    console.log(`   Has rasterUrl: ${!!result.data?.meta?.rasterUrl}`);
    console.log(`   RasterW: ${result.data?.meta?.rasterW}`);
    console.log(`   RasterH: ${result.data?.meta?.rasterH}`);
    console.log(`   Lines count: ${result.data?.meta?.lines?.length}`);

    if (response.status !== 200) {
      console.error(`❌ Caption preview failed:`, result);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`❌ Error testing caption preview:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Testing font parity fix implementation...\n');

  const fontTest = await testFontLoading();
  const rewrapTest = await testServerRewrap();

  console.log('\n📊 Test Results:');
  console.log(`   Font Loading: ${fontTest ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Server Rewrap: ${rewrapTest ? '✅ PASS' : '❌ FAIL'}`);

  if (fontTest && rewrapTest) {
    console.log('\n🎉 All tests passed! Font parity fix is working correctly.');
    console.log('\nNext steps:');
    console.log('1. Deploy the netlify.toml changes to enable font proxy');
    console.log('2. Test in browser: DevTools → Network → filter "font"');
    console.log(
      '3. Verify: document.fonts.check("italic 700 54px \\"DejaVu Sans\\"") returns true'
    );
    console.log('4. Test preview → save → render → no text cutoff');
  } else {
    console.log('\n❌ Some tests failed. Check the implementation.');
    process.exit(1);
  }
}

main().catch(console.error);
