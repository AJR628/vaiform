// test-proxy.mjs - Test Netlify proxy configuration
import fetch from 'node-fetch';

const BASE_URL = 'https://vaiform.com';

async function testEndpoint(path, description) {
  try {
    console.log(`\n🧪 Testing ${description}...`);
    console.log(`   URL: ${BASE_URL}${path}`);
    
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    console.log(`   Status: ${response.status} ${response.statusText}`);
    
    const contentType = response.headers.get('content-type');
    console.log(`   Content-Type: ${contentType}`);
    
    if (contentType?.includes('application/json')) {
      const data = await response.json();
      console.log(`   Response:`, JSON.stringify(data, null, 2));
    } else {
      const text = await response.text();
      console.log(`   Response (first 200 chars):`, text.substring(0, 200));
    }
    
    return response.status === 200;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Testing Netlify Proxy Configuration\n');
  
  const tests = [
    ['/stripe/webhook', 'Stripe Webhook Health Check'],
    ['/api/health', 'API Health Check (if exists)'],
    ['/', 'Home Page (SPA fallback)']
  ];
  
  let passed = 0;
  for (const [path, description] of tests) {
    const success = await testEndpoint(path, description);
    if (success) passed++;
  }
  
  console.log(`\n📊 Results: ${passed}/${tests.length} tests passed`);
  
  if (passed === tests.length) {
    console.log('✅ All tests passed! Proxy is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check Netlify deployment and proxy configuration.');
  }
}

runTests().catch(console.error);
