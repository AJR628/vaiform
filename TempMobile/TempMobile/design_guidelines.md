# Vaiform Mobile - Design Guidelines

## 1. Brand Identity

**Purpose**: Vaiform is a form builder and management platform. The mobile app enables users to access their form library, view submissions, and manage settings on-the-go. It should feel **professional, trustworthy, and efficient** without being sterile.

**Aesthetic Direction**: **Editorial/Professional** - Clean typographic hierarchy, generous whitespace, and purposeful use of color. Think of a productivity tool that feels organized and confidence-inspiring, not a flashy consumer app.

**Memorable Element**: A distinctive gradient accent system used sparingly on key CTAs and brand moments (login, success states). The gradient creates visual elevation without clutter.

## 2. Navigation Architecture

**Root Navigation**: Tab Bar (3 tabs)
- **Home** - Dashboard/overview
- **Library** - Form management (stub for now)
- **Settings** - Account and app preferences

**Auth Flow**: Stack-only navigation for Login/Signup screens, presented as a modal over the main app when user is not authenticated.

**Screen List**:
- Login (auth stack)
- Home (Home tab)
- Library (Library tab)
- Settings (Settings tab)

## 3. Screen-by-Screen Specifications

### Login Screen
**Purpose**: Authenticate users via Google Sign-In or email/password.

**Layout**:
- No header (full-screen branded experience)
- Top inset: insets.top + 60px
- Bottom inset: insets.bottom + 40px
- Vertically scrollable (for keyboard accommodation)

**Components**:
- App logo/wordmark at top (centered, 80px height)
- "Sign in to Vaiform" headline (Typography.h1, center-aligned)
- Google Sign-In button (prominent, full-width with icon)
- "or" divider with horizontal lines
- Email input field
- Password input field
- "Sign In" button (gradient background, disabled state when fields empty)
- "Create Account" link (Typography.caption, centered below, navigates to signup flow - stub for now)
- All input fields and buttons have 16px horizontal margin

**Empty States**: N/A

**Floating Elements**: None

---

### Home Screen
**Purpose**: Dashboard showing recent activity and quick actions. Includes "Test Backend" button for /health check.

**Layout**:
- Transparent header with title "Home" (Typography.h2)
- Top inset: headerHeight + 24px
- Bottom inset: tabBarHeight + 24px
- Scrollable content area

**Components**:
- Welcome message card ("Welcome back, [User Name]" - Typography.h3)
- "Test Backend" button (outlined style, full-width)
- API response display area (when button pressed, shows JSON in monospace font with light background)
- Quick stats placeholder (e.g., "3 Active Forms", "12 Responses Today" - stub data)
- Recent activity list (stub: show 2-3 placeholder items)

**Empty States**: If no forms exist, show empty-home.png illustration with message "No forms yet. Get started by creating your first form."

**Floating Elements**: None

---

### Library Screen
**Purpose**: Browse and manage forms (stub for now).

**Layout**:
- Transparent header with title "Library" and search icon in right button
- Top inset: headerHeight + 24px
- Bottom inset: tabBarHeight + 24px
- List/scroll view

**Components**:
- Search bar (collapsed by default, expands when header search icon tapped)
- Form list (stub: show 2-3 placeholder cards with form name, response count, last updated)
- Each card is tappable with subtle press feedback

**Empty States**: Show empty-library.png illustration with message "Your form library is empty. Forms you create will appear here."

**Floating Elements**: FAB (Floating Action Button) in bottom-right for "Create Form" action
- Position: 16px from right edge, tabBarHeight + 20px from bottom
- Size: 56x56px circle
- Shadow: width 0, height 2, opacity 0.10, radius 2
- Icon: Plus icon (Feather Icons)

---

### Settings Screen
**Purpose**: Account info, app preferences, and credits placeholder.

**Layout**:
- Default header with title "Settings"
- Top inset: 24px (non-transparent header)
- Bottom inset: tabBarHeight + 24px
- Scrollable form/list view

**Components**:
- Profile section (user avatar + name/email, non-editable for now)
- "Credits" placeholder row (shows "10 credits" - stub data)
- "Sign Out" button (destructive style, bottom of list)
- App version number at very bottom (Typography.caption, muted color)

**Empty States**: N/A

**Floating Elements**: None

---

## 4. Color Palette

**Primary**:
- Primary: `#4A5FFF` (vibrant blue, used for CTAs and key actions)
- PrimaryGradient: `linear-gradient(135deg, #4A5FFF 0%, #7B68EE 100%)`

**Backgrounds**:
- Background: `#FFFFFF`
- Surface: `#F8F9FB` (cards, input backgrounds)
- SurfaceSecondary: `#ECEEF3` (subtle dividers, disabled states)

**Text**:
- TextPrimary: `#1A1D29` (headlines, body text)
- TextSecondary: `#6B7280` (captions, helper text)
- TextTertiary: `#9CA3AF` (placeholders, muted labels)

**Semantic**:
- Success: `#10B981`
- Error: `#EF4444`
- Warning: `#F59E0B`

**Borders**:
- Border: `#E5E7EB` (input borders, card outlines)

---

## 5. Typography

**Font**: System default (SF Pro on iOS, Roboto on Android) - ensures maximum legibility and native feel for a productivity tool.

**Type Scale**:
- h1: 28px, Bold, TextPrimary (screen titles on auth flows)
- h2: 22px, Bold, TextPrimary (screen headers in navigation bar)
- h3: 18px, Semibold, TextPrimary (section headers, card titles)
- body: 16px, Regular, TextPrimary (standard body text)
- caption: 14px, Regular, TextSecondary (helper text, metadata)
- small: 12px, Regular, TextTertiary (labels, timestamps)

---

## 6. Visual Design

**Touchable Feedback**:
- All touchable elements have opacity 0.7 when pressed (React Native Pressable default)
- Buttons have subtle scale animation (0.98) on press

**Icons**: Feather Icons from @expo/vector-icons (24px default size, TextPrimary color unless specified)

**Drop Shadows**: Only on FAB (as specified in screen specs above)

**Card Style**: 
- Background: Surface
- Border: 1px solid Border
- Border radius: 12px
- Padding: 16px

**Input Fields**:
- Height: 48px
- Border: 1px solid Border
- Border radius: 8px
- Background: Surface
- Padding: 12px horizontal
- Focus state: Border color changes to Primary

**Buttons**:
- Height: 48px
- Border radius: 8px
- Primary: PrimaryGradient background, white text, bold
- Outlined: Transparent background, Primary border, Primary text
- Destructive: Transparent background, Error text

---

## 7. Assets to Generate

### Required Assets:

1. **icon.png**
   - App icon for device home screen
   - 1024x1024px, rounded corners handled by OS
   - Design: Stylized "V" lettermark in white on PrimaryGradient background
   - WHERE USED: Device home screen, app switcher

2. **splash-icon.png**
   - Icon shown during app launch
   - 512x512px
   - Design: Same "V" lettermark as icon.png
   - WHERE USED: Splash screen during app load

3. **empty-home.png**
   - Illustration for empty home state
   - 300x240px
   - Design: Minimal line illustration of a clipboard with checkmark, using Primary color (#4A5FFF) on transparent background
   - WHERE USED: Home screen when user has no forms

4. **empty-library.png**
   - Illustration for empty library state
   - 300x240px
   - Design: Minimal line illustration of an empty folder, using Primary color (#4A5FFF) on transparent background
   - WHERE USED: Library screen when user has no forms

### Optional (Generate if time permits):

5. **avatar-default.png**
   - Default user avatar
   - 200x200px
   - Design: Simple gradient circle with user initials placeholder
   - WHERE USED: Settings screen profile section

---

## Implementation Notes

- Use Expo's safe area context for all insets
- Test on both iOS and Android for platform-specific nuances
- Ensure all touch targets are minimum 44x44px (Apple HIG)
- Toast/Alert notifications should appear from top with slide-down animation, 4-second auto-dismiss
- Tab bar icons should use Feather Icons: home, book-open, settings