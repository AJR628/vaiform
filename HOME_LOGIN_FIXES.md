# Home Page Login/Signup Fixes

## Issues Fixed

### 1. Google Sign-In API Key Error
**Problem**: Firebase API key had a typo causing "api-key-not-valid" errors
**Solution**: Fixed API key in `firebaseClient.js` to match working `config.js`

**Before**: `AIzaSyBg9bqtZoTkC3vfEXk0vzLJAlTibXfjySY` (missing 'I')
**After**: `AIzaSyBg9bqtZoTkC3vfEXk0vzLJAITibXfjvSY` (correct)

### 2. Improved User Experience - Login vs Sign Up
**Problem**: Both Login and Sign Up buttons redirected to pricing page
**Solution**: Created distinct user flows:

- **Login Button** → Opens home login modal (for existing users)
- **Sign Up Button** → Redirects to pricing page (to choose a plan)

### 3. Added Home Login Modal
**Created**: New login modal on home page with:
- Google sign-in button
- Email/password form  
- "Don't have an account? Sign up here" link
- Proper form validation
- Modal close functionality

## New User Flows

### For Existing Users (Login):
1. Click "Login" on home page
2. Home login modal opens
3. Sign in with Google or email/password
4. Stay on home page, now authenticated

### For New Users (Sign Up):
1. Click "Sign Up" on home page
2. Redirected to pricing page
3. Choose a plan and authenticate
4. Get initialized with selected plan

### From Login Modal:
- **"Sign up here" link** → Closes modal, goes to pricing page

## Files Modified

### `public/index.html`:
- Added comprehensive login modal with Google and email/password options
- Modal includes proper form structure and accessibility

### `public/js/firebaseClient.js`:
- **CRITICAL FIX**: Corrected Firebase API key (was causing Google sign-in failures)

### `public/frontend.js`:
- Updated login button to open home modal instead of redirecting
- Added complete modal functionality:
  - `showHomeLoginModal()` and `hideHomeLoginModal()`
  - Email/password authentication
  - Google authentication with popup
  - Form validation and error handling
  - Modal close behaviors (button, outside click)

## Expected Results

### ✅ Fixed Issues:
- **No more Google sign-in API key errors**
- **Login button shows home modal** (doesn't redirect to pricing)
- **Sign up button redirects to pricing** (to choose plan)
- **Both Sign Up and Login buttons visible** when logged out

### 🎯 User Experience:
- **Existing users**: Quick login on home page without plan selection
- **New users**: Guided to pricing page to choose their plan
- **Clear separation** between login (existing) and signup (new + plan)

## Testing Checklist

- [ ] Home page shows both "Sign Up" (blue) and "Login" (gray) buttons when logged out
- [ ] "Login" button opens modal on home page
- [ ] "Sign Up" button redirects to pricing page
- [ ] Home login modal Google sign-in works (no API key errors)
- [ ] Home login modal email/password sign-in works
- [ ] "Sign up here" link in modal goes to pricing page
- [ ] Modal closes properly (X button, outside click)
- [ ] After home login, user stays on home page (authenticated)
- [ ] After pricing signup, user gets proper plan initialization

## Code Structure

### Home Login Modal (`public/index.html`):
```html
<div id="loginModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden">
  <!-- Google sign-in, email/password form, sign up link -->
</div>
```

### Modal Functions (`public/frontend.js`):
```javascript
// Login button → home modal (existing users)
loginBtn.addEventListener("click", () => showHomeLoginModal());

// Sign up button → pricing page (new users)  
signupBtn.addEventListener("click", () => window.location.href = "/pricing?auth=open");
```

This creates a much better user experience where existing users can quickly log in without being forced through the pricing page, while new users are properly guided to choose their plan.
