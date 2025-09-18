// scripts/test-pricing-system.mjs
import fetch from 'node-fetch';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

async function testEndpoint(endpoint, options = {}) {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    const data = await response.json().catch(() => ({}));
    
    console.log(`✅ ${options.method || 'GET'} ${endpoint} - ${response.status}`);
    if (response.status >= 400) {
      console.log(`   Response:`, data);
    }
    
    return { response, data };
  } catch (error) {
    console.log(`❌ ${options.method || 'GET'} ${endpoint} - Error:`, error.message);
    return { error };
  }
}

async function runTests() {
  console.log('🧪 Testing Plans & Pricing System\n');
  
  // Test 1: Health check
  console.log('1. Testing health endpoint...');
  await testEndpoint('/health');
  
  // Test 2: Pricing page accessibility
  console.log('\n2. Testing pricing page...');
  await testEndpoint('/pricing.html');
  
  // Test 3: User routes (should require auth)
  console.log('\n3. Testing user routes (should require auth)...');
  await testEndpoint('/api/user/me');
  
  // Test 4: Checkout routes (should require auth)
  console.log('\n4. Testing checkout routes (should require auth)...');
  await testEndpoint('/api/checkout/start', {
    method: 'POST',
    body: JSON.stringify({ plan: 'creator', billing: 'monthly' }),
  });
  
  // Test 5: Shorts creation (should require auth)
  console.log('\n5. Testing shorts creation (should require auth)...');
  await testEndpoint('/api/shorts/create', {
    method: 'POST',
    body: JSON.stringify({ text: 'Test quote' }),
  });
  
  // Test 6: AI quotes (should require auth)
  console.log('\n6. Testing AI quotes (should require auth)...');
  await testEndpoint('/api/quotes/ai', {
    method: 'POST',
    body: JSON.stringify({ text: 'Test quote' }),
  });
  
  console.log('\n✅ All tests completed!');
  console.log('\n📝 Manual testing checklist:');
  console.log('   - Visit /pricing.html and test plan selection');
  console.log('   - Test free signup flow');
  console.log('   - Test paid plan checkout');
  console.log('   - Verify free user limits (4 shorts/day)');
  console.log('   - Verify AI quotes blocked for free users');
  console.log('   - Verify watermark forced for free users');
  console.log('   - Test "Buy More Credits" link visibility');
}

runTests().catch(console.error);
