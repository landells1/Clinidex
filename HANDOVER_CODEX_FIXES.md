# Clinidex — Codex Fix Handover (Post-V2 Audit)

**Date:** 2026-04-29  
**Context:** Claude Code ran a thorough audit of the V2 implementation against `HANDOVER_V2.md`. This document is the complete fix list. Read `HANDOVER_V2.md` for full product context and constraints before starting. Read `AGENTS.md` for hard constraints (no advice, no Horus replacement, no patient data, RLS on all tables, auto-push after every task).

Work through tasks in the order listed. Auto-push after every completed task.

---

## TASK 1 — Fix: `specialty_entry_links` constraint reversed (CRITICAL)

**Problem:** `supabase/migrations/2026_04_28_v2_foundations.sql` correctly constrains `specialty_entry_links.entry_type = 'portfolio'` only. A subsequent migration (`2026_04_28_v2_audit_followups.sql`) reverses this, restoring `check (entry_type = any (array['portfolio','case']))`. The net live DB state allows cases as evidence again — directly violating the spec.

**Fix:** Create a new migration file `supabase/migrations/2026_04_29_fix_entry_type_constraints.sql`:

```sql
-- Re-enforce portfolio-only constraint on specialty_entry_links
-- (reversed in v2_audit_followups.sql — this corrects it)
delete from specialty_entry_links where entry_type = 'case';
alter table specialty_entry_links
  drop constraint if exists specialty_entry_links_entry_type_check;
alter table specialty_entry_links
  add constraint specialty_entry_links_entry_type_check
  check (entry_type = 'portfolio');

-- Re-enforce portfolio-only constraint on arcp_entry_links  
delete from arcp_entry_links where entry_type = 'case';
alter table arcp_entry_links
  drop constraint if exists arcp_entry_links_entry_type_check;
alter table arcp_entry_links
  add constraint arcp_entry_links_entry_type_check
  check (entry_type = 'portfolio');
```

Also edit `2026_04_28_v2_audit_followups.sql`: remove the lines that drop/recreate the `entry_type` constraint to `array['portfolio','case']` so that if the migration is ever re-run from scratch, there is no conflict.

**Acceptance:** `specialty_entry_links` and `arcp_entry_links` both have a `check (entry_type = 'portfolio')` constraint. No `case`-typed rows can be inserted.

---

## TASK 2 — Fix: Horus import not subscription-gated (CRITICAL)

**Problem:** `app/api/import/horus/route.ts` has zero subscription checks. Free users can bulk-import unlimited entries. Spec §5: bulk import is Pro only.

**Fix `app/api/import/horus/route.ts`:** Add gating at the top of the handler (after auth check, before processing):

```ts
import { fetchSubscriptionInfo } from '@/lib/subscription'

// Inside the route handler, after getting user:
const sub = await fetchSubscriptionInfo(supabase, user.id)
if (!sub.limits.canBulkImport) {
  return NextResponse.json(
    { error: 'Bulk import requires a Pro subscription.' },
    { status: 403 }
  )
}
```

**Fix `app/(dashboard)/import/page.tsx`:** Fetch subscription server-side and show an upgrade prompt if `!sub.limits.canBulkImport`. The import wizards should be hidden/disabled; replace with an upgrade card explaining that bulk import (CSV, Horus) is a Pro feature.

Pattern to follow: how the export page gates the PDF export tab.

**Acceptance:** A Free-tier user visiting `/import` sees an upgrade prompt, not the import wizard. A Free-tier user calling the Horus API directly gets a 403.

---

## TASK 3 — Fix: No IP-level rate limiting on `/share/[token]` (CRITICAL)

**Problem:** `middleware.ts` bypasses auth checks for `/share/` paths but adds no IP rate limiting. The per-link 100-views/hour auto-revoke exists in `app/api/share/access/route.ts` but a burst attack (or crawler) can trivially enumerate and exhaust a link before the per-link counter fires.

**Fix `middleware.ts`:** Add a rate limiter for public share routes using Vercel's built-in edge capabilities. Use an in-memory LRU or rely on Vercel's `@upstash/ratelimit` if available, or implement a simple sliding-window counter using the request IP.

If `@upstash/ratelimit` is not installed, implement a lightweight edge-compatible in-memory approach:

```ts
// At the top of middleware.ts
const SHARE_RATE_LIMIT = 5 // requests
const SHARE_RATE_WINDOW_MS = 60_000 // per minute

// Inside matcher — add before the share path bypass:
if (request.nextUrl.pathname.startsWith('/share/')) {
  const ip = request.ip ?? request.headers.get('x-forwarded-for') ?? 'unknown'
  // Use Vercel KV or a simple response header approach
  // Simplest production-safe approach: use the existing Supabase rate limit pattern
  // Return 429 if over limit
}
```

The safest approach given the existing stack: add an `X-RateLimit` check via Vercel Edge Config or KV. If neither is available, at minimum add these headers to the share route responses so downstream caching layers can rate-limit:

```ts
response.headers.set('X-RateLimit-Limit', '5')
response.headers.set('X-RateLimit-Window', '60')
```

And in `app/share/[token]/page.tsx` (the public page) — this is a server component, call the access log API route rather than directly querying Supabase, so the access tracking and rate limit logic is centralised.

**Acceptance:** Rapid repeated requests to `/share/[token]` from the same IP are throttled. 429 response returned above 5 req/min.

---

## TASK 4 — Fix: New user trigger sets `subscription_status='trial'` (CRITICAL)

**Problem:** `supabase/migrations/2026_04_28_v2_bugfixes.sql` — the `handle_new_user()` trigger inserts `subscription_status = 'trial'`. The V2 spec explicitly removes the time-based trial model. New users should be `'free'`.

**Fix:** Create migration `supabase/migrations/2026_04_29_fix_new_user_trigger.sql`:

```sql
-- Fix handle_new_user() to use 'free' tier, not legacy 'trial'
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_referral_code text;
  v_referrer_id uuid;
  v_is_student boolean;
begin
  -- Generate unique referral code
  v_referral_code := encode(gen_random_bytes(6), 'hex');

  -- Detect referrer if ref code passed via raw_user_meta_data
  if new.raw_user_meta_data->>'referral_code' is not null then
    select user_id into v_referrer_id
      from profiles
     where referral_code = new.raw_user_meta_data->>'referral_code'
     limit 1;
  end if;

  -- Student detection: .ac.uk email
  v_is_student := new.email ilike '%.ac.uk';

  insert into public.profiles (
    id,
    first_name,
    last_name,
    career_stage,
    onboarding_complete,
    tier,
    student_email_verified,
    subscription_status,
    referral_code,
    referred_by,
    pro_features_used,
    notification_preferences
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'career_stage', ''),
    false,
    case when v_is_student then 'student' else 'free' end,  -- 'free' not 'trial'
    v_is_student,
    'free',  -- no longer 'trial' — V2 uses usage-based limits
    v_referral_code,
    v_referrer_id,
    '{"pdf_exports_used":0,"share_links_used":0,"referral_pro_until":null}'::jsonb,
    '{"deadlines":true,"share_link_expiring":true,"activity_nudge":false,"application_window":true}'::jsonb
  );
  return new;
end;
$$;
```

**Acceptance:** New user sign-up creates a profile with `subscription_status = 'free'` and `tier = 'free'` (or `'student'` for `.ac.uk` emails). No `'trial'` values written.

---

## TASK 5 — Fix: Magic byte validation incomplete (CRITICAL)

**Problem:** `lib/upload/magic-bytes.ts` and `lib/supabase/storage.ts` only cover: PDF, PNG, JPEG, DOC (legacy), DOCX. The whitelist in the spec (HANDOVER_V2 §6) includes: PDF, DOCX, XLSX, PPTX, TXT, PNG, JPG/JPEG, HEIC. XLSX, PPTX, HEIC, and TXT are all missing.

**Fix `lib/upload/magic-bytes.ts`:** Add magic byte signatures:

```ts
// Add to the magic byte map:

// XLSX — Office Open XML (same ZIP-based header as DOCX/PPTX)
// All .xlsx/.docx/.pptx share the ZIP magic: 50 4B 03 04
// Disambiguate by checking internal file structure if needed, 
// but for the whitelist, accept the ZIP header for all Office Open XML types
// and rely on MIME type + extension for the final type.

// HEIC — ftyp box at offset 4: 66 74 79 70 68 65 69 63
{ mimeType: 'image/heic', offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // 'ftyp'

// TXT — no magic bytes (plain text has no header).
// Validate by attempting UTF-8 decode of first 512 bytes.
// Any non-printable bytes (excluding CR, LF, TAB) = reject.
```

For Office Open XML formats (XLSX, PPTX, DOCX), all three share the same ZIP magic bytes (`50 4B 03 04`). The approach: if the ZIP header matches AND the MIME type is one of `application/vnd.openxmlformats-officedocument.*`, accept it.

**Fix `lib/supabase/storage.ts` — `ALLOWED_MIME_TYPES`:** Add missing types:

```ts
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // XLSX
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
  'text/plain',   // TXT
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/heif',  // HEIC alternate MIME
]
```

**Also update `app/api/upload/authorize/route.ts`** to reject any MIME not in `ALLOWED_MIME_TYPES` before even checking magic bytes.

**Do NOT install `file-type` npm package** — the inline approach is already in place; extend it rather than adding a dependency.

**Acceptance:** Uploading an XLSX, PPTX, HEIC, or TXT file succeeds. Uploading an EXE or ZIP fails with a 415 error. Uploading a file with a renamed extension (e.g., `malware.exe` renamed to `document.pdf`) fails magic byte validation.

---

## TASK 6 — Fix: ClamAV Edge Function missing (CRITICAL → document as known gap)

**Problem:** `supabase/functions/` does not exist. The spec required a ClamAV scan Edge Function. Files are inserted with `scan_status='pending'` but never transition to `'clean'` — so all uploaded files are permanently inaccessible (blocked by the pending-status download check).

**This needs a two-part fix:**

### Part A — Immediate: Interim scan stub so uploads are usable

Until ClamAV is integrated, create a minimal Edge Function that marks files as clean after a delay (so users aren't blocked). **Add a clear TODO comment** that this must be replaced with real scanning before public launch.

Create `supabase/functions/scan-evidence/index.ts`:

```ts
// TODO: REPLACE WITH REAL CLAMAV SCAN BEFORE PUBLIC LAUNCH
// This stub immediately marks files as 'clean' to unblock uploads.
// Real implementation should: fetch file from storage, run ClamAV,
// set scan_status='clean' or 'quarantined' accordingly.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const { fileId } = await req.json()
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // STUB: mark as clean immediately
  const { error } = await supabase
    .from('evidence_files')
    .update({ scan_status: 'clean', scan_completed_at: new Date().toISOString() })
    .eq('id', fileId)

  if (error) return new Response(JSON.stringify({ error }), { status: 500 })
  return new Response(JSON.stringify({ status: 'clean' }), { status: 200 })
})
```

Create `supabase/functions/scan-evidence/deno.json` (if needed for imports).

### Part B — Wire the upload route to call the function

In `app/api/upload/authorize/route.ts` (or wherever the post-upload hook runs): after inserting the `evidence_files` row, invoke the scan function:

```ts
// After inserting evidence_files row:
await supabase.functions.invoke('scan-evidence', {
  body: { fileId: insertedFile.id }
})
```

**Acceptance:** Files transition from `scan_status='pending'` to `'clean'` after upload. Downloads are no longer permanently blocked. A large TODO comment clearly documents this is a stub awaiting real ClamAV integration.

---

## TASK 7 — Missing: Custom competency themes UI

**Problem:** `custom_competency_themes` table exists in the DB and themes are displayed in the Portfolio Themes view, but there is no UI to create, view, or delete custom themes. Users are stuck with only the preset 8.

**Fix — three parts:**

### Part A: Theme picker in entry form shows custom themes + add option

**File:** `components/portfolio/entry-form.tsx` (and `components/cases/case-form.tsx`)

In the `interview_themes` multi-select section, fetch the user's custom themes alongside presets:

```ts
// Fetch on component mount (client component)
const [customThemes, setCustomThemes] = useState<{ id: string; name: string; slug: string }[]>([])

useEffect(() => {
  supabase
    .from('custom_competency_themes')
    .select('id, name, slug')
    .then(({ data }) => setCustomThemes(data ?? []))
}, [])

// Combined list for rendering:
const allThemes = [
  ...INTERVIEW_THEMES,  // preset
  ...customThemes.map(t => ({ value: t.slug, label: t.name, isCustom: true }))
]
```

Below the theme chips, add a small "＋ Add theme" inline button that opens a minimal input:
- Text input: "Theme name" (max 40 chars)
- On submit: insert into `custom_competency_themes`, refresh the list, auto-select the new theme
- Validate: slug derived from name (lowercase, spaces→hyphens, strip special chars); reject if it collides with a preset slug

### Part B: Inline "Manage" button opens delete modal

Add a small "Manage" text button next to the theme picker label. Opens a modal listing custom themes only (presets not deletable). Each row has a delete button.

On delete:
1. Delete from `custom_competency_themes`
2. Remove the slug from `interview_themes[]` on all `portfolio_entries` and `cases` for this user:

```sql
-- Run as two updates via supabase client:
update portfolio_entries 
  set interview_themes = array_remove(interview_themes, $slug)
  where user_id = $userId;

update cases
  set interview_themes = array_remove(interview_themes, $slug)  
  where user_id = $userId;
```

### Part C: Settings page for theme management (secondary access)

**File:** `app/(dashboard)/settings/page.tsx` or new `app/(dashboard)/settings/themes/page.tsx`

Add a "Competency Themes" section (same manage/delete UI as the modal above, in a settings card). This is a secondary access point — the inline picker is primary.

**Acceptance:** Users can add custom competency themes from within an entry form. Custom themes appear alongside presets in the picker. Deleting a custom theme removes it from all entries. Settings also has a management view.

---

## TASK 8 — Missing: Onboarding ARCP step skipped for non-FY users

**Problem:** The ARCP step in onboarding is always shown regardless of career stage. Should be skipped for medical students (Y1-Y6) and post-FY users.

**File:** `app/onboarding/page.tsx`

**Fix:** Make `STEPS` dynamic based on career stage:

```ts
const getSteps = (careerStage: string): Step[] => {
  const base: Step[] = ['profile', 'specialties', 'first-entry']
  const fyStages = ['FY1', 'FY2']
  if (fyStages.includes(careerStage)) {
    return ['profile', 'specialties', 'arcp', 'first-entry']
  }
  return base
}

// After user sets career stage in step 1, update STEPS:
const steps = getSteps(careerStage)
```

When navigating "Continue" from step 2 (specialties), skip to 'arcp' only if FY1/FY2, otherwise go directly to 'first-entry'.

**Acceptance:** A user who selects Y3 in step 1 never sees the ARCP step. A user who selects FY1 does see it.

---

## TASK 9 — Missing: Per-step Skip button in onboarding

**Problem:** Steps 2 (specialties) and 3 (ARCP) have no way to skip without completing the step.

**File:** `app/onboarding/page.tsx`

**Fix:** Add a "Skip for now" text button below the primary "Continue" button on steps 2, 3 (and step 4 already has skip via the 3 action CTAs):

```tsx
{step !== 'profile' && step !== 'first-entry' && (
  <button
    type="button"
    onClick={handleNextStep}
    className="text-sm text-white/40 hover:text-white/60 transition-colors mt-2"
  >
    Skip for now
  </button>
)}
```

`handleNextStep` advances without validating the current step's form fields.

**Step 1 (profile)** — name + career stage should remain required (can't meaningfully skip). No skip button on step 1.

**Acceptance:** Steps 2 and 3 each have a "Skip for now" link. Skipping works without form validation errors.

---

## TASK 10 — Missing: Med student framing in onboarding specialties step

**Problem:** Specialties step shows identical text for all career stages. Spec requires different framing for Y1-Y6.

**File:** `app/onboarding/page.tsx` — specialties step heading/subtext:

```tsx
{careerStage && ['Y1','Y2','Y3','Y4','Y5','Y6'].includes(careerStage) ? (
  <>
    <h2>Which specialties interest you?</h2>
    <p>Start building evidence early. You can update this any time in Settings.</p>
  </>
) : (
  <>
    <h2>Add your tracked specialty programmes</h2>
    <p>We'll auto-populate application deadlines when you track a programme.</p>
  </>
)}
```

**Acceptance:** Med students see "Which specialties interest you?" framing. FY/post-FY see "tracked specialty programmes" framing.

---

## TASK 11 — Missing: POST_FY career stage option in onboarding

**Problem:** `CAREER_STAGES` in `app/onboarding/page.tsx` only goes up to FY2. `app/(dashboard)/settings/page.tsx` correctly includes `POST_FY`. Users who are post-foundation cannot self-identify during onboarding.

**File:** `app/onboarding/page.tsx`

Add `POST_FY` to the career stage options in step 1:

```ts
const CAREER_STAGES = [
  { value: 'Y1', label: 'Year 1 (Medical Student)' },
  { value: 'Y2', label: 'Year 2 (Medical Student)' },
  { value: 'Y3', label: 'Year 3 (Medical Student)' },
  { value: 'Y4', label: 'Year 4 (Medical Student)' },
  { value: 'Y5', label: 'Year 5 (Medical Student)' },
  { value: 'Y6', label: 'Year 6 (Medical Student)' },
  { value: 'FY1', label: 'Foundation Year 1 (FY1)' },
  { value: 'FY2', label: 'Foundation Year 2 (FY2)' },
  { value: 'POST_FY', label: 'Core/Specialty Training (CT/ST)' },
]
```

**Acceptance:** Onboarding and settings offer the same career stage options. `POST_FY` selectable in both places.

---

## TASK 12 — Missing: Email to link owner on auto-revoke

**Problem:** `app/api/share/access/route.ts` auto-revokes share links at 100 views in an hour but sends no email notification to the owner.

**File:** `app/api/share/access/route.ts`

In the auto-revoke branch, after updating `revoked_at`, send an email via Resend:

```ts
// After: await supabase.from('share_links').update({ revoked_at: new Date() })...

// Get owner email
const { data: ownerProfile } = await supabase
  .from('profiles')
  .select('id')
  .eq('id', shareLink.user_id)
  .single()

const { data: userData } = await supabaseAdmin.auth.admin.getUserById(shareLink.user_id)

if (userData?.user?.email) {
  await resend.emails.send({
    from: 'Clinidex <noreply@clinidex.co.uk>',
    to: userData.user.email,
    subject: 'Your shared portfolio link was auto-revoked',
    html: buildAutoRevokeEmail({
      userName: ownerProfile?.first_name ?? 'there',
      linkScope: shareLink.scope,
      viewCount: 100,
    })
  })
}
```

Add `buildAutoRevokeEmail()` to `lib/notifications/email-templates.ts` following the existing template pattern.

**Also check `notification_preferences`:** only send if `notification_preferences.share_link_expiring === true`.

**Acceptance:** When a share link hits 100 views and is auto-revoked, the owner receives an email (if their preferences allow it). Build passes.

---

## TASK 13 — Wrong: "Interview themes" label not renamed to "Competency themes"

**Problem:** `components/portfolio/entry-form.tsx` label still reads "Interview themes". `INTERVIEW_THEMES` constant name is also unchanged.

**Files to update:**

1. **`components/portfolio/entry-form.tsx`** — change label from `"Interview themes"` to `"Competency themes"`.

2. **`components/cases/case-form.tsx`** — same label change.

3. **`lib/constants/interview-themes.ts`** (or wherever `INTERVIEW_THEMES` is defined) — add an alias export but do not break existing imports:
   ```ts
   export const COMPETENCY_THEMES = INTERVIEW_THEMES  // alias; rename over time
   ```

4. **`app/(dashboard)/portfolio/page.tsx`** — remove the runtime string patch `name.replace('Interview', 'Competency')` and use the constant's label directly.

Do NOT rename the DB column `interview_themes` — that would require a migration and all existing data. Just update UI labels.

**Acceptance:** Entry forms show "Competency themes" not "Interview themes". The Themes view on Portfolio shows proper names without runtime patching.

---

## TASK 14 — Wrong: Share link expiry presets missing

**Problem:** The share link creation modal uses a plain date picker. Spec requires preset radio buttons: 1 day / 1 week / 1 month / Custom.

**File:** `app/(dashboard)/export/page.tsx` — share link creation modal:

```tsx
// Replace the plain date input with:
const EXPIRY_PRESETS = [
  { label: '1 day', days: 1 },
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: 'Custom', days: null },
]

const [expiryPreset, setExpiryPreset] = useState<number | null>(30)
const [customExpiry, setCustomExpiry] = useState<string>('')  // ISO date

// UI: 4 radio/pill buttons for presets. If "Custom" selected, show a date picker.
// Max custom expiry: 90 days from today (enforce on submit).
```

Computed `expires_at` on submit:
```ts
const expiresAt = expiryPreset
  ? new Date(Date.now() + expiryPreset * 86_400_000).toISOString()
  : customExpiry  // validated to be within 90 days
```

**Acceptance:** Share link creation shows 4 preset options. Custom shows a date picker capped at 90 days. The chosen expiry is correctly saved to `share_links.expires_at`.

---

## TASK 15 — Wrong: Cron schedule is 08:00 UTC (should be 09:00)

**File:** `vercel.json`

Change: `"schedule": "0 8 * * *"` → `"schedule": "0 9 * * *"`

**Acceptance:** Vercel cron runs at 09:00 UTC daily.

---

## TASK 16 — Wrong: ARCP per-category summary shows text counts, not visual bars

**Problem:** Spec C10 requires a "per-category strip with small bars" in the ARCP header. Currently shows text counts next to section headings, not a compact header strip.

**File:** `components/arcp/arcp-page-client.tsx`

Add a visual summary strip in the overview header, above the capability list:

```tsx
{/* Per-category bars in the summary header */}
<div className="grid grid-cols-2 gap-3 mt-4">
  {ARCP_CATEGORIES.map(cat => {
    const total = capabilities.filter(c => c.category === cat.key).length
    const linked = capabilities.filter(c => c.category === cat.key && hasEvidence(c.capability_key)).length
    const pct = total > 0 ? Math.round((linked / total) * 100) : 0
    return (
      <div key={cat.key}>
        <div className="flex justify-between text-xs text-white/50 mb-1">
          <span>{cat.label}</span>
          <span>{linked}/{total}</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#1B6FD9] rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    )
  })}
</div>
```

**Acceptance:** ARCP page header shows 4 small progress bars (one per category: Clinical, Safety, Professional, Development) with `X/Y` counts.

---

## TASK 17 — Wrong: Personal templates not shown first in template picker

**Problem:** Spec C11: "Personal templates list shown first in picker; curated below." Currently the picker shows mixed or curated-first order.

**File:** `components/portfolio/template-picker-modal.tsx`

Sort the template list so `is_curated = false` rows appear first. In the query or in the component:

```ts
const personal = templates.filter(t => !t.is_curated)
const curated = templates.filter(t => t.is_curated)
const sorted = [...personal, ...curated]
```

Add a visual divider between sections if the user has personal templates:

```tsx
{personal.length > 0 && (
  <>
    <p className="text-xs text-white/40 px-2 pb-1">Your templates</p>
    {personal.map(renderTemplate)}
    <div className="border-t border-white/[0.06] my-2" />
    <p className="text-xs text-white/40 px-2 pb-1">Clinidex templates</p>
  </>
)}
{curated.map(renderTemplate)}
```

**Acceptance:** If a user has saved personal templates, they appear above a divider, with curated templates below.

---

## TASK 18 — Incomplete: No 50-revision cap on version history

**Problem:** `entry_revisions` rows grow unbounded per entry. Spec C15: "Cap at 50 revisions per entry; oldest auto-pruned."

**Files:** `components/portfolio/entry-form.tsx` and `components/cases/case-form.tsx`

After inserting a new revision, prune oldest beyond 50:

```ts
// After: await supabase.from('entry_revisions').insert({ ... })

// Prune if over 50
const { data: revisions } = await supabase
  .from('entry_revisions')
  .select('id')
  .eq('entry_id', entryId)
  .eq('entry_type', entryType)
  .order('created_at', { ascending: true })

if (revisions && revisions.length > 50) {
  const toDelete = revisions.slice(0, revisions.length - 50).map(r => r.id)
  await supabase
    .from('entry_revisions')
    .delete()
    .in('id', toDelete)
}
```

Apply the same pruning in `app/api/history/restore/route.ts` after a restore creates a new revision.

**Acceptance:** An entry that has been edited 60 times has exactly 50 revisions. Oldest are removed.

---

## TASK 19 — Incomplete: Print stylesheet missing `@page` user name/date header

**Problem:** `app/globals.css` `@media print` section only has a page counter in `@bottom-right`. Missing the user name + date header.

**Fix:** The user name can't easily be injected via pure CSS (requires JS). Implement via a component:

**Create `components/print-header.tsx`:**

```tsx
'use client'
import { useEffect, useState } from 'react'

export function PrintHeader({ userName }: { userName: string }) {
  const [date, setDate] = useState('')
  useEffect(() => {
    setDate(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))
  }, [])
  
  return (
    <div className="print-header hidden print:block text-xs text-gray-500 pb-2 mb-4 border-b border-gray-200">
      {userName} — Clinidex portfolio — {date}
    </div>
  )
}
```

Add this component near the top of `app/(dashboard)/layout.tsx` (server) or in the `app/share/[token]/page.tsx` public view, passing the user's name.

In `app/globals.css` under `@media print`, also add:

```css
.print-header {
  display: block !important;
}
```

**Acceptance:** Ctrl+P shows a header line with the user's name and date at the top of the printed page.

---

## TASK 20 — Incomplete: Snapshot in version history uses `initialData` (stale risk)

**Problem:** `components/portfolio/entry-form.tsx` saves `snapshot: initialData` as the revision — using the prop value passed when the component mounted, not the current DB state. If the DB was updated externally between page load and save, the snapshot is stale.

**Fix:** Before updating the entry on save, fetch the current DB row to use as the snapshot:

```ts
// In the form submit handler, before the update:
const { data: currentRow } = await supabase
  .from('portfolio_entries')
  .select('*')
  .eq('id', entryId)
  .single()

// Use currentRow as the snapshot, not initialData:
await supabase.from('entry_revisions').insert({
  user_id: userId,
  entry_id: entryId,
  entry_type: 'portfolio',
  snapshot: currentRow  // not initialData
})
```

Apply the same fix to `components/cases/case-form.tsx`.

**Acceptance:** Version history snapshots reflect the actual DB state at the time of the save, not stale component props.

---

## TASK 21 — Incomplete: Cron jobs for soft-delete purge and share link expiry not configured

**Problem:** The `vercel.json` only configures the notifications cron. Spec §3 requires three scheduled jobs:
1. Daily: purge soft-deleted entries older than 30 days
2. Weekly: purge audit logs older than 1 year
3. Daily: set `revoked_at` on share links past `expires_at`

**Fix — Option A (Preferred): Add API routes + vercel.json entries**

Create `app/api/cron/purge-deleted/route.ts`:
```ts
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  // Verify cron secret header
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const supabase = createServiceClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
  await supabase.from('cases').delete().lt('deleted_at', thirtyDaysAgo).not('deleted_at', 'is', null)
  await supabase.from('portfolio_entries').delete().lt('deleted_at', thirtyDaysAgo).not('deleted_at', 'is', null)
  return new Response('OK')
}
```

Create `app/api/cron/purge-audit-log/route.ts`:
```ts
// Similar pattern — delete audit_log rows older than 1 year
```

Create `app/api/cron/expire-share-links/route.ts`:
```ts
// Set revoked_at = now() on share_links where expires_at < now() and revoked_at is null
```

**Add to `vercel.json`:**
```json
{
  "crons": [
    { "path": "/api/cron/notifications", "schedule": "0 9 * * *" },
    { "path": "/api/cron/purge-deleted", "schedule": "0 2 * * *" },
    { "path": "/api/cron/expire-share-links", "schedule": "0 1 * * *" },
    { "path": "/api/cron/purge-audit-log", "schedule": "0 3 * * 0" }
  ]
}
```

**Acceptance:** All three cron routes exist and are registered in `vercel.json`. Soft-deleted entries older than 30 days are hard-deleted daily. Expired share links get `revoked_at` set daily.

---

## TASK 22 — Minor: PIN input placeholder inconsistency

**Problem:** `app/(dashboard)/export/page.tsx` share modal PIN placeholder says "Optional, 4-8 digits" but spec says 4-digit PIN.

**Decision:** Keep 4–8 digits (more flexible, already implemented in `lib/share/pin.ts`) but update the placeholder and in-form help text to say "Optional PIN (4–8 digits)" consistently. Do not change the validation logic.

**Acceptance:** Consistent "4–8 digits" language everywhere PIN is mentioned.

---

## TASK 23 — Minor: Privacy policy contact section needs its own heading

**Problem:** UK GDPR best practice requires a dedicated "Data Controller" or "Contact Us" section. Currently the contact email is buried within the GDPR rights section.

**File:** `app/privacy/page.tsx`

Add a separate `<section>` at the bottom (before the "Last updated" line):

```
## Data Controller & Contact

Clinidex is operated by [your legal entity name], registered in England and Wales.

For data subject requests (access, deletion, rectification, portability) or any privacy-related query, contact us at: admin@clinidex.co.uk

We aim to respond to all requests within 30 days as required by UK GDPR.
```

Fill in the legal entity name — don't leave it blank.

**Acceptance:** Privacy policy has a standalone "Data Controller & Contact" section with entity name and response timeframe.

---

## Final checklist before pushing

After completing all tasks, verify:

- [ ] `specialty_entry_links` only accepts `entry_type = 'portfolio'`
- [ ] Horus import page shows upgrade prompt for Free users; API returns 403
- [ ] `/share/[token]` returns 429 after 5 req/min per IP
- [ ] New user signup sets `subscription_status = 'free'`, not `'trial'`
- [ ] XLSX, PPTX, HEIC, TXT can be uploaded; .exe files cannot
- [ ] Uploading any file transitions `scan_status` from `'pending'` to `'clean'`
- [ ] Entry forms have "Competency themes" label (not "Interview themes")
- [ ] Entry forms show custom theme picker with Add + Manage buttons
- [ ] Onboarding skips ARCP step for non-FY1/FY2 users
- [ ] Onboarding has Skip button on steps 2 and 3
- [ ] Onboarding includes POST_FY career stage option
- [ ] Share link creation modal has 1-day / 1-week / 1-month / Custom expiry presets
- [ ] Auto-revoke at 100 views sends email to owner (respecting notification prefs)
- [ ] ARCP header shows 4 small per-category progress bars
- [ ] Personal templates appear first in template picker
- [ ] Entry revisions capped at 50 per entry (oldest pruned)
- [ ] Snapshots use fresh DB state, not stale `initialData`
- [ ] Print header shows user name + date
- [ ] All 4 cron jobs registered in `vercel.json`
- [ ] Cron schedule is `0 9 * * *`
- [ ] Privacy policy has standalone Data Controller section
- [ ] PIN placeholder consistently says "4–8 digits"
- [ ] `npm run build` passes with no type errors
