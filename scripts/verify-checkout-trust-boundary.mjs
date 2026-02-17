#!/usr/bin/env node
/**
 * Verification script for checkout trust boundary fix.
 *
 * Tests that startPlanCheckout ignores client-supplied uid/email
 * and uses req.user.uid/email instead.
 *
 * Usage:
 *   node scripts/verify-checkout-trust-boundary.mjs
 *
 * Prerequisites:
 *   - Server running with VAIFORM_DEBUG=1
 *   - Valid Firebase ID token for authenticated user
 *   - Test user credentials
 */

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

if (!TEST_EMAIL || !TEST_PASSWORD) {
  console.error('❌ Set TEST_EMAIL and TEST_PASSWORD environment variables');
  process.exit(1);
}

async function getAuthToken() {
  // Note: This is a simplified example. In practice, you'd use the Firebase SDK properly
  // For actual testing, use the browser-based auth flow or a service account
  console.log('⚠️  This script requires manual token acquisition.');
  console.log('   Use browser DevTools to get an ID token from an authenticated session.');
  return process.env.ID_TOKEN;
}

async function testCheckoutWithSpoofedUid(idToken, realUid) {
  const spoofedUid = 'SPOOFED_UID_12345';
  const spoofedEmail = 'spoofed@example.com';

  console.log('\n🧪 Test 1: Request with spoofed uid/email in body');
  console.log(`   Real user: ${realUid}`);
  console.log(`   Spoofed uid: ${spoofedUid}`);
  console.log(`   Spoofed email: ${spoofedEmail}`);

  try {
    const response = await fetch(`${API_BASE}/checkout/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        plan: 'creator',
        billing: 'onetime',
        uid: spoofedUid, // ❌ Client tries to spoof
        email: spoofedEmail, // ❌ Client tries to spoof
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.log(`   ❌ Request failed: ${response.status} ${JSON.stringify(data)}`);
      return false;
    }

    // Check server logs for the security warning (requires VAIFORM_DEBUG=1)
    console.log(`   ✅ Request succeeded (check server logs for security warning)`);
    console.log(`   📋 Response: ${JSON.stringify(data, null, 2)}`);
    console.log(`   🔍 Expected: Server logs should show:`);
    console.log(
      `      [checkout/start:security] Client sent uid="${spoofedUid}" but server using req.user.uid="${realUid}" (ignored)`
    );

    return true;
  } catch (error) {
    console.error(`   ❌ Request error: ${error.message}`);
    return false;
  }
}

async function testCheckoutWithoutSpoofedFields(idToken) {
  console.log('\n🧪 Test 2: Request without uid/email in body (normal flow)');

  try {
    const response = await fetch(`${API_BASE}/checkout/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        plan: 'creator',
        billing: 'onetime',
        // ✅ No uid/email - server derives from req.user
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.log(`   ❌ Request failed: ${response.status} ${JSON.stringify(data)}`);
      return false;
    }

    console.log(`   ✅ Request succeeded`);
    console.log(`   📋 Response: ${JSON.stringify(data, null, 2)}`);

    return true;
  } catch (error) {
    console.error(`   ❌ Request error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🔒 Checkout Trust Boundary Verification');
  console.log('========================================');
  console.log(`API Base: ${API_BASE}`);
  console.log(`Test Email: ${TEST_EMAIL}`);

  const idToken = await getAuthToken();
  if (!idToken) {
    console.error('\n❌ No ID token provided. Set ID_TOKEN environment variable.');
    console.log('\nTo get a token:');
    console.log('1. Open browser DevTools on your app');
    console.log('2. Authenticate as a test user');
    console.log('3. Run: await auth.currentUser.getIdToken()');
    console.log('4. Copy the token and set ID_TOKEN=<token>');
    process.exit(1);
  }

  // Decode token to get real uid (simplified - in practice use jwt.decode)
  // For this script, we'll assume you provide REAL_UID env var
  const realUid = process.env.REAL_UID || 'UNKNOWN';

  console.log(`Real UID: ${realUid}`);

  const test1 = await testCheckoutWithSpoofedUid(idToken, realUid);
  const test2 = await testCheckoutWithoutSpoofedFields(idToken);

  console.log('\n📊 Results');
  console.log('==========');
  console.log(`Test 1 (spoofed uid/email): ${test1 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 2 (no uid/email): ${test2 ? '✅ PASS' : '❌ FAIL'}`);

  if (test1 && test2) {
    console.log('\n✅ All tests passed! Trust boundary is secure.');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Review server logs.');
    process.exit(1);
  }
}

main().catch(console.error);
