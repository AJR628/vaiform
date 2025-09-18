# Plans & Pricing System Implementation

## Overview
Implemented a new plans & pricing system with Free, Creator ($9.99), and Pro ($19.99) tiers, replacing the old "Buy Credits" tab with a comprehensive pricing page.

## Backend Changes

### 1. New Checkout Routes (`src/routes/checkout.routes.js`)
- Added `/api/checkout/start` endpoint for plan subscriptions
- Supports Creator/Pro plans with monthly/one-time billing
- Keeps legacy credit pack routes alive but hidden

### 2. Plan Guards Middleware (`src/middleware/planGuards.js`)
- `requireMember()` - Blocks free users from premium features
- `enforceFreeDailyShortLimit(4)` - Limits free users to 4 shorts/day
- `blockAIQuotesForFree()` - Blocks AI quote generation for free users
- `enforceWatermarkFlag()` - Forces watermarks for free users

### 3. User Service (`src/services/user.service.js`)
- `ensureFreeUser()` - Creates user docs with free plan setup
- `getUserData()` - Fetches user data with membership status

### 4. User Routes (`src/routes/user.routes.js`)
- `POST /api/user/setup` - Ensures user document exists after signup
- `GET /api/user/me` - Gets current user data with plan info

### 5. Updated Controllers
- **Shorts Controller**: Added daily count increment after successful creation
- **Webhook Controller**: Enhanced to handle plan subscriptions with bonus credits
  - Creator: +1,500 bonus credits
  - Pro: +3,500 bonus credits
  - One-time passes: 30-day expiration

### 6. Route Updates
- **Shorts Routes**: Added plan guards to `/create` endpoint
- **Quotes Routes**: Added AI quotes blocking for free users

## Frontend Changes

### 1. New Pricing Page (`public/pricing.html`)
- Three-tier pricing display (Free, Creator, Pro)
- Firebase Auth integration for signup/login
- Plan selection with monthly/one-time options
- Responsive design with modern UI

### 2. Pricing JavaScript (`public/js/pricing.js`)
- Firebase Auth state management
- User setup after sign-in
- Checkout flow integration
- Auth modal for free signup

### 3. Success Page (`public/success.html`)
- Plan activation confirmation
- Membership status polling
- User-friendly success messaging

### 4. Navigation Updates
- Replaced "Buy Credits" with "Plans & Pricing"
- Added "Buy More Credits" link for logged-in users
- Hidden credit packs from main navigation

### 5. Buy Credits Page Updates
- Added power user notice
- Link back to main pricing page
- Maintained existing functionality for credit top-ups

## Plan Features

### Free Plan
- Up to 4 shorts/day
- Watermarked exports
- 50-quote bank access
- Basic templates
- Email signup required

### Creator Plan ($9.99/month)
- 100 shorts/month
- No watermark
- AI quote engine
- Premium voices/styles
- +1,500 bonus credits
- All templates

### Pro Plan ($19.99/month)
- 250 shorts/month
- No watermark
- Advanced editing
- Priority rendering
- +3,500 bonus credits
- All templates + premium features

## Environment Variables Required
```env
STRIPE_PRICE_PRO_PASS=price_1S8gryE7IEw9f8cliLtVLrLx
STRIPE_PRICE_PRO_SUB=price_1S8grZE7IEw9f8clEaYtxb4n
STRIPE_PRICE_CREATOR_PASS=price_1S8gorE7IEw9f8clUPVYBTkN
STRIPE_PRICE_CREATOR_SUB=price_1S8gqIE7IEw9f8clNl6KDPcH
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=https://vaiform.com
```

## Testing Checklist
- [ ] Visit `/pricing.html` and test plan selection
- [ ] Test free signup flow
- [ ] Test paid plan checkout
- [ ] Verify free user limits (4 shorts/day)
- [ ] Verify AI quotes blocked for free users
- [ ] Verify watermark forced for free users
- [ ] Test "Buy More Credits" link visibility
- [ ] Test webhook handling for plan activations
- [ ] Test one-time pass expiration logic

## API Endpoints

### New Endpoints
- `POST /api/checkout/start` - Start plan checkout
- `POST /api/user/setup` - Setup user after signup
- `GET /api/user/me` - Get user data with plan info

### Updated Endpoints
- `POST /api/shorts/create` - Now enforces daily limits and watermarks
- `POST /api/quotes/ai` - Now blocks free users
- Webhook endpoints - Now handle plan subscriptions

## Database Schema Updates
User documents now include:
```javascript
{
  uid: string,
  email: string,
  plan: 'free' | 'creator' | 'pro',
  isMember: boolean,
  credits: number,
  membership: {
    kind: 'monthly' | 'onetime',
    plan: string,
    expiresAt?: number // for one-time passes
  },
  shortDayKey: string, // YYYY-MM-DD
  shortCountToday: number
}
```

## Migration Notes
- Existing users will be treated as free users until they upgrade
- Legacy credit pack functionality remains intact
- Webhook handles both old credit packs and new plan subscriptions
- User documents are automatically created on first sign-in
