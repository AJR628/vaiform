# Goal
Add a POST /enhance-image route that:
- Validates { prompt: string, strength?: number in [0,1] }.
- Calls `enhanceService.enhancePrompt(prompt, strength)` (create if missing).
- Deducts 1 credit from the authenticated user (assume `req.user.email` exists).
- Responds with { enhancedPrompt }.

# Files to create/touch
- src/services/enhance.service.js
- src/controllers/enhance.controller.js
- src/routes/enhance.routes.js
- src/config/pricing.js (export ENHANCE_COST=1 if not present)

# Notes
- ESM only. Minimal validation ok if zod not present.
Tue Aug 12 07:12:44 PM UTC 2025
Tue Aug 12 07:23:37 PM UTC 2025
Tue Aug 12 07:27:00 PM UTC 2025
Tue Aug 12 07:29:40 PM UTC 2025
Tue Aug 12 07:33:41 PM UTC 2025
Tue Aug 12 07:36:53 PM UTC 2025
