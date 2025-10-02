# SSOT Implementation Test Plan

## Overview
This document outlines the test plan for verifying that the Background SSOT (Single Source of Truth) implementation works correctly.

## Test Scenario: AI Remix Background Mismatch Fix

### Prerequisites
1. User is logged in to Creative Studio
2. User has sufficient credits (20+ for AI generation)
3. User has selected a quote

### Test Steps

#### Step 1: Generate AI Remix
1. Navigate to Creative Studio
2. Select 1-2 stock images and click "Remix" button
3. Enter a prompt (e.g., "A serene mountain landscape at sunset")
4. Click "20 Credits" button to generate AI remix
5. **Verify**: AI result preview shows the generated image
6. **Verify**: Console logs show `[bg.ssot] Preview URL captured:` with the frontend URL

#### Step 2: Save & Use AI Remix
1. Click "Save & Use" button on the AI result
2. **Verify**: Console logs show `[bg.ssot] Preview URL captured:` with SSOT information
3. **Verify**: Preview shows the exact same image as the AI result
4. **Verify**: `selectedAsset.bgSSOT` is populated with correct information

#### Step 3: Create Short
1. Click "Render Short" button
2. **Verify**: Console logs show `[bg.ssot] Using SSOT URL for render:` with SSOT information
3. **Verify**: Console logs show `[bg.ssot] Including SSOT in payload:` 
4. **Verify**: Backend logs show `[bg.ssot] Received SSOT:` with correct information
5. **Verify**: Backend logs show `[bg.ssot] Using SSOT URL for AI background:` with the preview URL
6. **Verify**: Backend logs show `[bg.ssot] Copied to register URL:` with the register URL
7. **Verify**: Backend logs show `[bg.ssot] ✅ SSOT working: frontend asset copied to register directory`

#### Step 4: Verify Final Result
1. **Verify**: The rendered short uses the exact same image as the preview
2. **Verify**: No random/fallback images are used
3. **Verify**: The background image matches what was shown in the AI remix preview

## Expected Logs

### Frontend Logs
```
[bg.ssot] Preview URL captured: {kind: 'ai', url: 'https://.../artifacts/uid/frontend-ts/image_0.png', ...}
[bg.ssot] Using SSOT URL for render: {kind: 'ai', url: 'https://.../artifacts/uid/frontend-ts/image_0.png', ...}
[bg.ssot] Including SSOT in payload: {kind: 'ai', url: 'https://.../artifacts/uid/frontend-ts/image_0.png', ...}
```

### Backend Logs
```
[bg.ssot] Received SSOT: {kind: 'ai', url: 'https://.../artifacts/uid/frontend-ts/image_0.png', ...}
[bg.ssot] Preview URL: https://.../artifacts/uid/frontend-ts/image_0.png
[bg.ssot] Source: frontend
[bg.ssot] Using SSOT URL for AI background: https://.../artifacts/uid/frontend-ts/image_0.png
[bg.ssot] Source: frontend
[bg.ssot] Copying frontend asset to register directory
[bg.ssot] Copied to register URL: https://.../artifacts/uid/register-ts/image_0.png
[bg.ssot] Final background URL: https://.../artifacts/uid/register-ts/image_0.png
[bg.ssot] Verification - Preview URL: https://.../artifacts/uid/frontend-ts/image_0.png
[bg.ssot] Verification - Render URL: https://.../artifacts/uid/register-ts/image_0.png
[bg.ssot] ✅ SSOT working: frontend asset copied to register directory
```

## Success Criteria
1. ✅ Preview and render use the exact same image
2. ✅ No random/fallback images are used
3. ✅ Console logs show proper SSOT flow
4. ✅ Backend successfully copies frontend asset to register directory
5. ✅ No errors in the asset copying process

## Failure Scenarios to Test
1. **Network failure during asset copy**: Should fall back to original SSOT URL
2. **Invalid SSOT URL**: Should log error and continue with original background URL
3. **Missing SSOT**: Should work normally without SSOT (backward compatibility)

## Regression Tests
1. **Stock-only backgrounds**: Should still render correctly
2. **Upload backgrounds**: Should still work as before
3. **Caption/audio paths**: Should remain unchanged
4. **Pagination**: Should not be affected
