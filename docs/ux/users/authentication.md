# Authentication

User authentication system using email-based magic links for passwordless login.

---

## User Goals

- **Sign in easily** without remembering passwords
- **Know I'm logged in** with clear UI feedback
- **Access my data** from any device
- **Sign out securely** when needed
- **Trust my data is safe** with proper security

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| First visit Boards | Sign up quickly | Start using the app |
| Return to Boards | Be remembered | Not re-authenticate every time |
| Use a new device | Sign in easily | Access my existing data |
| Leave a public computer | Sign out | Protect my account |
| Wonder if I'm logged in | See clear status | Know my session state |

---

## Wireframes

### Auth Prompt (Not Logged In)

```
┌─────────────────────────────────────────────────────────┐
│  BOARDS                                    [Sign In]    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │                                                 │    │
│  │   Sign in to sync your boards across devices   │    │
│  │                                                 │    │
│  │            [ Sign In with Email ]              │    │
│  │                                                 │    │
│  │       or continue without an account           │    │
│  │           (data stored locally only)           │    │
│  │                                                 │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Sign In Modal

```
┌─────────────────────────────────────────┐
│  Sign In                          [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Enter your email to receive a          │
│  sign-in link (no password needed)      │
│                                         │
│  Email:                                 │
│  ┌─────────────────────────────────┐    │
│  │ your@email.com                  │    │
│  └─────────────────────────────────┘    │
│                                         │
│           [ Send Sign-In Link ]         │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  By signing in, you agree to our        │
│  Terms of Service and Privacy Policy    │
│                                         │
└─────────────────────────────────────────┘
```

### Check Your Email

```
┌─────────────────────────────────────────┐
│  Check Your Email                 [X]   │
├─────────────────────────────────────────┤
│                                         │
│           📧                            │
│                                         │
│  We sent a sign-in link to:             │
│  your@email.com                         │
│                                         │
│  Click the link in the email to         │
│  complete sign in.                      │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  Didn't receive it?                     │
│  [ Resend ] (available in 58s)          │
│                                         │
│  [ Use different email ]                │
│                                         │
└─────────────────────────────────────────┘
```

### Logged In Header

```
┌──────────────────────────────────────────────────────┐
│  BOARDS                              [ian ▾] [+ Add] │
└──────────────────────────────────────────────────────┘
                                         ↑
                                    User menu

User menu dropdown:
┌─────────────────────────┐
│  👤 Account             │
│  ⚙️ Settings            │
│  ─────────────────────  │
│  🚪 Sign Out            │
└─────────────────────────┘
```

### Account Modal

```
┌─────────────────────────────────────────┐
│  Account                          [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Email:                                 │
│  your@email.com                         │
│                                         │
│  Username:                              │
│  ┌─────────────────────────────────┐    │
│  │ ian                             │    │
│  └─────────────────────────────────┘    │
│  (shown on shared boards)               │
│                                         │
│           [ Save Changes ]              │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  Account created: Jan 15, 2024          │
│  Pins saved: 156                        │
│                                         │
└─────────────────────────────────────────┘
```

---

## Auth Flow

```
User clicks "Sign In"
        │
        ▼
┌─────────────────┐
│ Enter email     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Send magic link │  → Supabase Auth
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ User checks     │
│ email inbox     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Click link      │  → Returns to app
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Session created │  → Logged in!
└─────────────────┘
```

---

## Session Management

| State | Behavior |
|-------|----------|
| **Logged Out** | Data in localStorage only |
| **Logging In** | Show spinner, disable actions |
| **Logged In** | Sync to Supabase, show username |
| **Session Expired** | Prompt to re-authenticate |

### Session Persistence
- Sessions stored in localStorage
- Auto-refresh before expiry
- 30-day session duration
- Secure, httpOnly cookies

---

## Known Extensions / Future States

### Short-term
- **Social login** - Google, Apple, GitHub
- **Session list** - See all active sessions
- **Force logout everywhere** - Security feature

### Medium-term
- **Two-factor auth** - Additional security
- **Account deletion** - GDPR compliance
- **Email change** - Update account email

### Long-term
- **SSO/Enterprise** - Organization accounts
- **API tokens** - For integrations
- **Audit log** - Track account activity

---

## Security Considerations

- **No passwords stored** - Magic link only
- **Rate limiting** - 5 attempts per minute
- **Link expiry** - Magic links expire in 1 hour
- **Secure transport** - HTTPS only
- **Session rotation** - New token on each sign-in

---

## Technical Notes

- Authentication via Supabase Auth
- Magic links sent via Supabase built-in email
- Session managed by `onAuthStateChange()` listener
- Username stored in `profiles` table
- `getStoredAuth()` / `getStoredSession()` for state access
