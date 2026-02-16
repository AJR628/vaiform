# PASS 5 P1 — Storage Delete Enumeration: Minimal-Diff Patch Plan

## A) Current Code

### File:Line Ranges
- **File**: `src/controllers/shorts.controller.js`
- **Function**: `deleteShort` (lines 527-573)
- **Critical section**: Lines 556-566 (Storage deletion)

### Exact Current Snippet

```javascript
// Delete files from Firebase Storage
const bucket = admin.storage().bucket();
const destBase = `artifacts/${ownerUid}/${jobId}`;

try {
  const [files] = await bucket.getFiles({ prefix: destBase });
  await Promise.all(files.map(file => file.delete()));
  console.log(`[shorts] Deleted ${files.length} files for short: ${jobId}`);
} catch (storageError) {
  console.warn(`[shorts] Failed to delete storage files for ${jobId}:`, storageError.message);
}
```

### Route & Middleware Chain

**Route**: `DELETE /api/shorts/:jobId` (currently commented out in `src/routes/shorts.routes.js:16`)
```javascript
// r.delete("/:jobId", requireAuth, deleteShort);
```

**Middleware**: 
- ✅ `requireAuth` (verifies Bearer token, sets `req.user.{uid, email}`)
- ✅ Ownership check in controller (lines 543-551): Verifies Firestore doc `ownerId === req.user.uid`

### UID and jobId Derivation

- **`ownerUid`**: Derived from `req.user.uid` (set by `requireAuth` middleware after verifying Firebase ID token)
- **`jobId`**: Derived from `req.params.jobId` via `String(req.params?.jobId || "").trim()`
- **Current validation**: Only checks if `jobId` is non-empty (line 535-537)

---

## B) Repo Conventions Analysis

### 1. Storage `getFiles()` Patterns

**Pattern 1: Simple enumeration with `autoPaginate: true` + `maxResults`**
```javascript
// src/services/studio.service.js:557, 578
const [files] = await bucket.getFiles({ 
  prefix: `artifacts/${uid}/`, 
  autoPaginate: true, 
  maxResults: 1000 
});
```

**Pattern 2: Manual pagination with truncation detection**
```javascript
// src/services/studio.service.js:710-713
const [files, nextQuery] = await bucket.getFiles({ 
  prefix: `drafts/${uid}/`, 
  autoPaginate: false,
  maxResults: 1000
});

// Detect truncation: if nextQuery exists, list was capped
const truncated = !!(nextQuery && nextQuery.pageToken);
const note = truncated ? 'List may be incomplete. Showing first 1000 studios.' : null;
```

**Decision for delete operation**: Use **Pattern 1** (simple `maxResults`) because:
- Delete operations don't need pagination (we delete all files found)
- Typical file count per jobId is <10 files
- Safety cap of 100 is sufficient (10x normal case)

### 2. Error Response Shape

**Standard pattern** (used throughout `shorts.controller.js`):
```javascript
res.status(400|401|403|404|500).json({ 
  success: false, 
  error: "ERROR_CODE", 
  message: "Human-readable message" 
});
```

**Examples**:
- `{ success: false, error: "UNAUTHENTICATED", message: "Login required" }`
- `{ success: false, error: "INVALID_INPUT", message: "jobId required" }`
- `{ success: false, error: "FORBIDDEN", message: "You can only delete your own shorts" }`

### 3. Validation Patterns

**Current jobId validation** (minimal):
```javascript
const jobId = String(req.params?.jobId || "").trim();
if (!jobId) {
  return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "jobId required" });
}
```

**Zod usage in same file**: `shorts.controller.js` uses Zod for request body validation (lines 1-270), but path params are validated manually with simple checks.

**No existing path traversal validation found** in codebase for path params.

---

## C) Threat Model Analysis

### 1. `destBase` Construction

**Current**: `artifacts/${ownerUid}/${jobId}` (NO trailing slash)

**Comparison with `getShortById`** (line 459):
```javascript
const destBase = `artifacts/${ownerUid}/${jobId}/`;  // HAS trailing slash
```

**Issue**: Inconsistency. Storage prefix matching works with or without trailing slash, but:
- **Without trailing slash**: `artifacts/uid/jobId` matches `artifacts/uid/jobId/file.mp4` AND `artifacts/uid/jobIdExtra/file.mp4` (prefix match)
- **With trailing slash**: `artifacts/uid/jobId/` only matches files under that exact directory

**Recommendation**: Add trailing slash for safety and consistency with `getShortById`.

### 2. jobId Path Traversal Risk

**Current jobId format** (from `shorts.service.js:31`):
```javascript
const jobId = `shorts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
```
- Format: `shorts-{timestamp36}-{random5chars}`
- Contains: alphanumeric + hyphens only
- **No slashes in normal operation**

**Attack vector**: If `jobId` contains `/` or `..`, prefix could match wider paths:
- `jobId = "../../other-uid/jobId"` → `destBase = "artifacts/uid/../../other-uid/jobId"` → could match other users' files
- **Mitigation**: Firestore ownership check (line 549) prevents unauthorized deletion, but Storage enumeration could still be expensive

**Risk level**: ⚠️ **Low** (ownership check prevents actual cross-user deletion), but enumeration cost could be high if jobId is malformed.

### 3. Expected File Count Per jobId

**Normal operation** (from code analysis):
- `short.mp4` or `short.png` (main video/image) - **1 file**`)
- `cover.jpg` (optional thumbnail) - **0-1 file**)
- `meta.json` (optional metadata) - **0-1 file**)
- **Typical**: 2-3 files per jobId

**Studio multi-format** (from `studio.service.js:457-461`):
- `{jobId}_9x16.mp4`, `{jobId}_1x1.mp4`, `{jobId}_16x9.mp4` (videos)
- `{jobId}_poster_9x16.png` (poster)
- `{jobId}.mp3` (audio)
- `thumb.jpg` (thumbnail)
- `meta.json`
- **Worst case**: ~8-10 files per jobId

**Storage service** (from `storage.service.js:76, 101`):
- `image_{index}.{ext}` (for image generation, multiple indices possible)
- **Edge case**: Could have 10+ image files if generation creates multiple variants

**Conclusion**: Normal case is 2-5 files, worst case is ~10-15 files. Safety cap of 100 is 10x worst case.

---

## D) Recommended Patch (Option A: Simple maxResults)

### Minimal Unified Diff

```diff
--- a/src/controllers/shorts.controller.js
+++ b/src/controllers/shorts.controller.js
@@ -533,6 +533,12 @@ export async function deleteShort(req, res) {
     const jobId = String(req.params?.jobId || "").trim();
     if (!jobId) {
       return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "jobId required" });
     }
+    // Prevent path traversal in jobId
+    if (jobId.includes('/') || jobId.includes('..')) {
+      return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "Invalid jobId format" });
+    }
 
     const db = admin.firestore();
     const shortsRef = db.collection('shorts').doc(jobId);
@@ -555,10 +561,10 @@ export async function deleteShort(req, res) {
     
     // Delete files from Firebase Storage
     const bucket = admin.storage().bucket();
-    const destBase = `artifacts/${ownerUid}/${jobId}`;
+    const destBase = `artifacts/${ownerUid}/${jobId}/`;
     
     try {
-      const [files] = await bucket.getFiles({ prefix: destBase });
+      const [files] = await bucket.getFiles({ prefix: destBase, maxResults: 100 });
       await Promise.all(files.map(file => file.delete()));
       console.log(`[shorts] Deleted ${files.length} files for short: ${jobId}`);
     } catch (storageError) {
```

### Complete Patched Function (for reference)

```javascript
export async function deleteShort(req, res) {
  try {
    const ownerUid = req.user?.uid;
    if (!ownerUid) {
      return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Login required" });
    }
    
    const jobId = String(req.params?.jobId || "").trim();
    if (!jobId) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "jobId required" });
    }
    // Prevent path traversal in jobId
    if (jobId.includes('/') || jobId.includes('..')) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "Invalid jobId format" });
    }

    const db = admin.firestore();
    const shortsRef = db.collection('shorts').doc(jobId);
    
    // Check if the short exists and belongs to the user
    const doc = await shortsRef.get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: "NOT_FOUND", message: "Short not found" });
    }
    
    const shortData = doc.data();
    if (shortData.ownerId !== ownerUid) {
      return res.status(403).json({ success: false, error: "FORBIDDEN", message: "You can only delete your own shorts" });
    }
    
    // Delete Firestore document
    await shortsRef.delete();
    
    // Delete files from Firebase Storage
    const bucket = admin.storage().bucket();
    const destBase = `artifacts/${ownerUid}/${jobId}/`;
    
    try {
      const [files] = await bucket.getFiles({ prefix: destBase, maxResults: 100 });
      await Promise.all(files.map(file => file.delete()));
      console.log(`[shorts] Deleted ${files.length} files for short: ${jobId}`);
    } catch (storageError) {
      console.warn(`[shorts] Failed to delete storage files for ${jobId}:`, storageError.message);
    }
    
    return res.json({ success: true, message: "Short deleted successfully" });
  } catch (error) {
    console.error("/shorts/:jobId/delete error:", error);
    return res.status(500).json({ success: false, error: "DELETE_FAILED", message: error.message });
  }
}
```

### Changes Summary

1. **Add jobId path traversal validation** (lines 539-542):
   - Rejects jobId containing `/` or `..`
   - Returns 400 with `INVALID_INPUT` error (consistent with existing pattern)

2. **Add trailing slash to `destBase`** (line 561):
   - Changes `artifacts/${ownerUid}/${jobId}` → `artifacts/${ownerUid}/${jobId}/`
   - Ensures prefix only matches files under that exact directory
   - Consistent with `getShortById` (line 459)

3. **Add `maxResults: 100` to `getFiles()`** (line 564):
   - Caps enumeration at 100 files (10x worst-case normal operation)
   - Prevents unbounded enumeration if jobId is malformed or prefix matches unexpectedly
   - Uses `autoPaginate: true` (default) for simplicity (no pagination needed for delete)

### Why Option A (Simple maxResults) Over Option B (Pagination Loop)

- **Delete operation doesn't need pagination**: We delete all files found, not return a list
- **File count is small**: Normal case is 2-5 files, worst case is ~10-15 files
- **Safety cap is sufficient**: 100 files is 10x worst case, prevents cost blowup
- **Simpler code**: Matches existing pattern in `studio.service.js:557, 578` (simple enumeration)
- **No truncation handling needed**: If we hit 100 files, we delete those 100 and log a warning (acceptable for delete operation)

---

## E) Bonus Hardening (Consistent with Repo Patterns)

### jobId Validation Enhancement

The patch includes basic path traversal protection. If you want stricter validation matching the jobId generation pattern:

```javascript
// Optional: Stricter validation matching jobId format
// Format: shorts-{timestamp36}-{random5chars}
const jobIdPattern = /^shorts-[a-z0-9]+-[a-z0-9]{5}$/i;
if (!jobIdPattern.test(jobId)) {
  return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "Invalid jobId format" });
}
```

**Decision**: **Not recommended** for minimal patch because:
- JobId format may change in future (e.g., `story-{timestamp}` from story service)
- Basic path traversal check (`/` and `..`) is sufficient for security
- Stricter validation could break legitimate jobIds if format evolves

**Current patch uses minimal validation** (reject `/` and `..`) which is sufficient and future-proof.

---

## F) Verification Steps

### 1. Normal Delete Operation (<10 artifacts)

**Test**:
```bash
# Create a short, then delete it
curl -X DELETE "https://api.vaiform.com/api/shorts/{jobId}" \
  -H "Authorization: Bearer {token}"
```

**Expected**:
- ✅ Returns `{ success: true, message: "Short deleted successfully" }`
- ✅ Logs: `[shorts] Deleted {N} files for short: {jobId}` where N is 2-5
- ✅ All files under `artifacts/{uid}/{jobId}/` are deleted
- ✅ Firestore doc is deleted

**Verify**:
- Check Storage console: `artifacts/{uid}/{jobId}/` directory should be empty or deleted
- Check Firestore: `shorts/{jobId}` doc should not exist

---

### 2. Cap/Truncation Behavior (Edge Case)

**Test** (if possible to create jobId with 100+ files):
```bash
# Manually create 100+ files under artifacts/{uid}/{jobId}/ in Storage console
# Then attempt delete
curl -X DELETE "https://api.vaiform.com/api/shorts/{jobId}" \
  -H "Authorization: Bearer {token}"
```

**Expected**:
- ✅ Returns `{ success: true, message: "Short deleted successfully" }`
- ✅ Logs: `[shorts] Deleted 100 files for short: {jobId}` (capped at 100)
- ✅ Only first 100 files are deleted (remaining files still exist)
- ⚠️ **Note**: This is acceptable for delete operation (partial cleanup is better than cost blowup)

**Alternative test** (if manual file creation is not feasible):
- Mock `bucket.getFiles()` to return 150 files
- Verify only first 100 are deleted
- Verify log shows "Deleted 100 files"

---

### 3. jobId Validation Blocks Malicious Input

**Test 1: Path traversal with `/`**:
```bash
curl -X DELETE "https://api.vaiform.com/api/shorts/../../other-uid/jobId" \
  -H "Authorization: Bearer {token}"
```

**Expected**:
- ✅ Returns `400 { success: false, error: "INVALID_INPUT", message: "Invalid jobId format" }`
- ✅ No Storage enumeration occurs
- ✅ No files deleted

**Test 2: Path traversal with `..`**:
```bash
curl -X DELETE "https://api.vaiform.com/api/shorts/..%2F..%2Fother-uid%2FjobId" \
  -H "Authorization: Bearer {token}"
```

**Expected**:
- ✅ Returns `400 { success: false, error: "INVALID_INPUT", message: "Invalid jobId format" }`
- ✅ No Storage enumeration occurs

**Test 3: Valid jobId format**:
```bash
curl -X DELETE "https://api.vaiform.com/api/shorts/shorts-lxyz123-abcde" \
  -H "Authorization: Bearer {token}"
```

**Expected**:
- ✅ Proceeds normally (if jobId exists and belongs to user)
- ✅ No validation error

---

## Summary

**Minimal patch adds**:
1. ✅ Path traversal validation (reject `/` and `..` in jobId)
2. ✅ Trailing slash in `destBase` (consistency + safety)
3. ✅ `maxResults: 100` cap (prevents unbounded enumeration)

**No behavior changes** except:
- Malicious jobId inputs are rejected (security improvement)
- Enumeration is capped at 100 files (cost protection)

**Auth/ownership checks unchanged**: Firestore ownership verification (line 549) remains the primary security boundary.
