# Security and Integration Test Plan

Use this checklist when adding a test runner or validating a release candidate.

## API route coverage

- Authenticated mutations reject cross-site or missing-origin browser POST/PATCH/DELETE requests.
- Authenticated routes return 401 without a Supabase session.
- Ownership checks reject access to another user's portfolio entries, cases, evidence files, templates, share links, and calendar feeds.
- Public share links enforce PIN requirements, failed PIN lockout, rolling request limits, expiry, revocation, and no `notes` field in the payload.
- Upload authorization rejects unsupported MIME types, oversized files, and quota overflow.
- Upload verification marks MIME-only fallback distinctly from ClamAV scans.
- Stripe webhook rejects invalid signatures and only grants Pro for `active` or `trialing` subscriptions.
- Cron routes reject missing or incorrect `CRON_SECRET`.

## Entitlement coverage

- Student tier requires institutional email verification.
- Student accounts fall back when verification expires, graduation date passes, or the user moves to FY/POST_FY.
- Foundation tier keeps free feature limits.
- Referral Pro access expires at `referral_pro_until`.
- `get_profile_entitlements` RPC failure fails closed in app code.
- Free PDF/share usage increments atomically under concurrent requests.
