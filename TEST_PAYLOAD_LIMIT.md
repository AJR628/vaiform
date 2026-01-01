# Payload Limit Verification Tests

## Implementation Summary

**File Modified**: `src/app.js`
**Lines Added**: 78-85 (conditional JSON parser before global parser)
**Change**: Conditional 200kb limit for `/api/caption/preview`, `/api/caption/render`, `/api/tts/preview`

---

## Test Commands

### Prerequisites
- Replace `YOUR_TOKEN` with a valid Firebase Auth token
- Ensure server is running on `http://localhost:3000` (or adjust BASE_URL)
- For payload generation, use actual valid JSON structures (these examples use simplified payloads)

---

## Test 1a: 300KB Payload to /api/caption/preview (Should Return 413/400)

```bash
# Generate a 300KB JSON payload
python3 << 'EOF'
import json
import sys

payload = {
    "ssotVersion": 3,
    "mode": "raster",
    "text": "x" * 280000,  # Large text field (~280KB)
    "lines": ["line1", "line2"],
    "rasterW": 500,
    "rasterH": 100,
    "yPx_png": 960,
    "totalTextH": 50,
    "yPxFirstLine": 935,
    "frameW": 1080,
    "frameH": 1920,
    "fontPx": 48
}

json_str = json.dumps(payload)
print(f"Payload size: {len(json_str)} bytes", file=sys.stderr)
print(json_str)
EOF
```

```bash
# Send 300KB payload (should fail with 413)
curl -X POST http://localhost:3000/api/caption/preview \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- \
  -w "\nHTTP Status: %{http_code}\n" \
  -v \
  < <(python3 << 'EOF'
import json
payload = {"ssotVersion": 3, "mode": "raster", "text": "x" * 280000, "lines": ["test"], "rasterW": 500, "rasterH": 100, "yPx_png": 960, "totalTextH": 50, "yPxFirstLine": 935, "frameW": 1080, "frameH": 1920, "fontPx": 48}
print(json.dumps(payload))
EOF
)
```

**Expected**: HTTP 413 (Payload Too Large) or HTTP 400 with "request entity too large"  
**Current (before fix)**: HTTP 200 OK  
**After fix**: HTTP 413/400

---

## Test 1b: Small Authenticated Request to /api/caption/preview (Should Return 200)

```bash
curl -X POST http://localhost:3000/api/caption/preview \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ssotVersion": 3,
    "mode": "raster",
    "text": "test caption",
    "lines": ["test caption"],
    "rasterW": 500,
    "rasterH": 100,
    "yPx_png": 960,
    "totalTextH": 50,
    "yPxFirstLine": 935,
    "frameW": 1080,
    "frameH": 1920,
    "fontPx": 48
  }' \
  -w "\nHTTP Status: %{http_code}\n" \
  | jq '.ok'
```

**Expected**: HTTP 200 with `{ "ok": true, ... }`  
**Should still work**: Yes

---

## Test 1c: Small Unauthenticated Request to /api/caption/preview (Should Return 401)

```bash
curl -X POST http://localhost:3000/api/caption/preview \
  -H "Content-Type: application/json" \
  -d '{
    "ssotVersion": 3,
    "mode": "raster",
    "text": "test",
    "lines": ["test"],
    "rasterW": 500,
    "rasterH": 100,
    "yPx_png": 960,
    "totalTextH": 50,
    "yPxFirstLine": 935,
    "frameW": 1080,
    "frameH": 1920,
    "fontPx": 48
  }' \
  -w "\nHTTP Status: %{http_code}\n" \
  | jq '.'
```

**Expected**: HTTP 401 with `{ "success": false, "error": "AUTH_REQUIRED", "code": "UNAUTHENTICATED", ... }`  
**Should still work**: Yes

---

## Test 2a: 300KB Payload to /api/caption/render (Should Return 413/400)

```bash
curl -X POST http://localhost:3000/api/caption/render \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- \
  -w "\nHTTP Status: %{http_code}\n" \
  -v \
  < <(python3 << 'EOF'
import json
payload = {"placement": "custom", "yPct": 0.5, "text": "x" * 280000, "fontPx": 48}
print(json.dumps(payload))
EOF
)
```

**Expected**: HTTP 413/400  
**After fix**: HTTP 413/400

---

## Test 2b: Small Authenticated Request to /api/caption/render (Should Return 200)

```bash
curl -X POST http://localhost:3000/api/caption/render \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "placement": "custom",
    "yPct": 0.5,
    "text": "test caption",
    "fontPx": 48
  }' \
  -w "\nHTTP Status: %{http_code}\n" \
  | jq '.success'
```

**Expected**: HTTP 200 with `{ "success": true, ... }`  
**Should still work**: Yes

---

## Test 2c: Small Unauthenticated Request to /api/caption/render (Should Return 401)

```bash
curl -X POST http://localhost:3000/api/caption/render \
  -H "Content-Type: application/json" \
  -d '{
    "placement": "custom",
    "yPct": 0.5,
    "text": "test",
    "fontPx": 48
  }' \
  -w "\nHTTP Status: %{http_code}\n" \
  | jq '.'
```

**Expected**: HTTP 401  
**Should still work**: Yes

---

## Test 3a: 300KB Payload to /api/tts/preview (Should Return 413/400)

```bash
curl -X POST http://localhost:3000/api/tts/preview \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- \
  -w "\nHTTP Status: %{http_code}\n" \
  -v \
  < <(python3 << 'EOF'
import json
payload = {"text": "x" * 290000, "voice": "alloy"}
print(json.dumps(payload))
EOF
)
```

**Expected**: HTTP 413/400  
**After fix**: HTTP 413/400

---

## Test 3b: Small Authenticated Request to /api/tts/preview (Should Return 200)

```bash
curl -X POST http://localhost:3000/api/tts/preview \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "test text",
    "voice": "alloy"
  }' \
  -w "\nHTTP Status: %{http_code}\n" \
  | jq '.'
```

**Expected**: HTTP 200  
**Should still work**: Yes

---

## Test 3c: Small Unauthenticated Request to /api/tts/preview (Should Return 401)

```bash
curl -X POST http://localhost:3000/api/tts/preview \
  -H "Content-Type: application/json" \
  -d '{
    "text": "test",
    "voice": "alloy"
  }' \
  -w "\nHTTP Status: %{http_code}\n" \
  | jq '.'
```

**Expected**: HTTP 401  
**Should still work**: Yes

---

## Simplified Test Script (All Tests in One)

Save this as `test_payload_limit.sh`:

```bash
#!/bin/bash
set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
TOKEN="${TOKEN:-YOUR_TOKEN}"

echo "=== Test 1: /api/caption/preview ==="
echo "1a. 300KB payload (should fail with 413/400):"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/caption/preview" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(python3 << 'EOF'
import json
print(json.dumps({"ssotVersion": 3, "mode": "raster", "text": "x" * 280000, "lines": ["test"], "rasterW": 500, "rasterH": 100, "yPx_png": 960, "totalTextH": 50, "yPxFirstLine": 935, "frameW": 1080, "frameH": 1920, "fontPx": 48}))
EOF
)")
echo "Status: $STATUS (expected: 413 or 400)"

echo "1b. Small auth request (should return 200):"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/caption/preview" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ssotVersion":3,"mode":"raster","text":"test","lines":["test"],"rasterW":500,"rasterH":100,"yPx_png":960,"totalTextH":50,"yPxFirstLine":935,"frameW":1080,"frameH":1920,"fontPx":48}')
echo "Status: $STATUS (expected: 200)"

echo "1c. Small unauth request (should return 401):"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/caption/preview" \
  -H "Content-Type: application/json" \
  -d '{"ssotVersion":3,"mode":"raster","text":"test","lines":["test"],"rasterW":500,"rasterH":100,"yPx_png":960,"totalTextH":50,"yPxFirstLine":935,"frameW":1080,"frameH":1920,"fontPx":48}')
echo "Status: $STATUS (expected: 401)"

echo ""
echo "=== Test 2: /api/caption/render ==="
echo "2a. 300KB payload (should fail with 413/400):"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/caption/render" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(python3 << 'EOF'
import json
print(json.dumps({"placement": "custom", "yPct": 0.5, "text": "x" * 280000, "fontPx": 48}))
EOF
)")
echo "Status: $STATUS (expected: 413 or 400)"

echo "2b. Small auth request (should return 200):"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/caption/render" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"placement":"custom","yPct":0.5,"text":"test","fontPx":48}')
echo "Status: $STATUS (expected: 200)"

echo "2c. Small unauth request (should return 401):"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/caption/render" \
  -H "Content-Type: application/json" \
  -d '{"placement":"custom","yPct":0.5,"text":"test","fontPx":48}')
echo "Status: $STATUS (expected: 401)"

echo ""
echo "=== Test 3: /api/tts/preview ==="
echo "3a. 300KB payload (should fail with 413/400):"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/tts/preview" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(python3 << 'EOF'
import json
print(json.dumps({"text": "x" * 290000, "voice": "alloy"}))
EOF
)")
echo "Status: $STATUS (expected: 413 or 400)"

echo "3b. Small auth request (should return 200):"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/tts/preview" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"test","voice":"alloy"}')
echo "Status: $STATUS (expected: 200)"

echo "3c. Small unauth request (should return 401):"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/tts/preview" \
  -H "Content-Type: application/json" \
  -d '{"text":"test","voice":"alloy"}')
echo "Status: $STATUS (expected: 401)"

echo ""
echo "=== All Tests Complete ==="
```

Run with:
```bash
chmod +x test_payload_limit.sh
TOKEN="your-actual-token" ./test_payload_limit.sh
```

---

## Expected Results Summary

| Test | Endpoint | Payload Size | Auth | Expected Status | Notes |
|------|----------|--------------|------|-----------------|-------|
| 1a | /api/caption/preview | 300KB | Yes | 413/400 | Size limit enforced |
| 1b | /api/caption/preview | Small | Yes | 200 | Still works |
| 1c | /api/caption/preview | Small | No | 401 | Auth still works |
| 2a | /api/caption/render | 300KB | Yes | 413/400 | Size limit enforced |
| 2b | /api/caption/render | Small | Yes | 200 | Still works |
| 2c | /api/caption/render | Small | No | 401 | Auth still works |
| 3a | /api/tts/preview | 300KB | Yes | 413/400 | Size limit enforced |
| 3b | /api/tts/preview | Small | Yes | 200 | Still works |
| 3c | /api/tts/preview | Small | No | 401 | Auth still works |

---

## Server Log Checks

After running tests, check server logs for:
- `"request entity too large"` or `"entity too large"` errors (size limit working)
- `[requireAuth]` log messages (auth middleware executing)
- No 200 OK responses for 300KB+ payloads

---

## Notes

- **Status Code**: Express body-parser typically returns 413 (Payload Too Large), but some versions may return 400 with "request entity too large" message. Both indicate the limit is working.
- **Payload Size**: Ensure JSON payload (after stringification) exceeds 200KB, not just the text content.
- **Route-Level Parsers**: Left in place for now (as requested). They will be redundant but harmless after this fix.
- **Global Parser**: Other routes still use 10mb limit (unchanged).

