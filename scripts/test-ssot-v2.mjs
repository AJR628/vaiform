#!/usr/bin/env node
/**
 * Test SSOT V2 implementation
 * Verifies that preview generates and render consumes SSOT v2 metadata correctly
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing SSOT V2 Implementation\n');

// Check that required files exist and contain expected code
const checks = [
  {
    file: 'src/routes/caption.preview.routes.js',
    mustContain: [
      'ssotVersion: 2',
      'splitLines: lines',
      'lineSpacingPx: lineSpacingPx',
      'yPxFirstLine: yPxFirstLine',
      'totalTextH: totalTextH'
    ],
    description: 'Server returns SSOT v2 with all required fields'
  },
  {
    file: 'src/render/overlay.helpers.js',
    mustContain: [
      'const hasV2 = ssotVersion === 2',
      'willUseSSOT: true',
      "mode: 'ssot'",
      "xExpr: `(W - text_w)/2`"
    ],
    description: 'Overlay helper forces SSOT path for v2'
  },
  {
    file: 'src/utils/ffmpeg.video.js',
    mustContain: [
      'const useSSOT = placement?.willUseSSOT === true',
      'if (useSSOT && splitLines && splitLines.length > 0)',
      'console.log(\'[ffmpeg] Using SSOT values verbatim',
      'textToRender = splitLines.join'
    ],
    description: 'FFmpeg uses SSOT values and splitLines'
  },
  {
    file: 'public/js/caption-preview.js',
    mustContain: [
      'ssotVersion: 2',
      'splitLines: Array.isArray(meta.splitLines)',
      'yPxFirstLine: yPxFirstLine'
    ],
    description: 'Client saves SSOT v2 to localStorage'
  }
];

let passed = 0;
let failed = 0;

for (const check of checks) {
  try {
    const filePath = join(__dirname, '..', check.file);
    const content = readFileSync(filePath, 'utf-8');
    
    const missing = [];
    for (const pattern of check.mustContain) {
      if (!content.includes(pattern)) {
        missing.push(pattern);
      }
    }
    
    if (missing.length === 0) {
      console.log(`✅ ${check.file}`);
      console.log(`   ${check.description}`);
      passed++;
    } else {
      console.log(`❌ ${check.file}`);
      console.log(`   ${check.description}`);
      console.log(`   Missing patterns:`);
      missing.forEach(p => console.log(`     - "${p}"`));
      failed++;
    }
  } catch (err) {
    console.log(`❌ ${check.file}`);
    console.log(`   Error reading file: ${err.message}`);
    failed++;
  }
  console.log('');
}

// Summary
console.log('─'.repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
  console.log('✨ All SSOT V2 checks passed!\n');
  console.log('Next steps:');
  console.log('1. Clear browser localStorage: localStorage.clear()');
  console.log('2. Generate a new preview with custom text');
  console.log('3. Check server logs for:');
  console.log('   - "ssotVersion:2"');
  console.log('   - "willUseSSOT:true"');
  console.log('   - "splitLines:<count>"');
  console.log('   - "Using SSOT values verbatim"');
  console.log('4. Verify no "Ignoring saved preview" warnings');
  console.log('5. Render and compare with preview positioning\n');
  process.exit(0);
} else {
  console.log('❌ Some checks failed. Review the implementation.\n');
  process.exit(1);
}

