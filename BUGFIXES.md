# Bug Fixes — ComLinkr Backend

This document lists **changes made to fix bugs** during development and validation (including Sprint 10 and related work). New features are not listed here.

---

## 1. Authentication & Account Deletion

### 1.1 Login during pending account deletion

**Problem:** After a user requested account deletion (`POST /settings/delete-account`), `isActive` was set to `false`. The auth login flow rejected all inactive users, so the user could not log back in to call `POST /settings/cancel-deletion` within the 15-day window.

**Fix:** Allow login when the user is in the **pending-deletion** state: `isActive === false` and `deletedAt` is set and **in the future** (`deletedAt > now()`).

**Files changed:**

- **`src/modules/auth/auth.service.ts`**
  - **Local login (`login`):** Replaced `if (!user || !user.isActive)` with a check that allows access when `pendingDeletion === true` (i.e. `user.deletedAt && user.deletedAt > now`). Reject only when user is missing or (inactive and not pending deletion).
  - **Google callback:** Same logic: allow when `!user.isActive && !pendingDeletion` is false (i.e. allow when active or pending deletion).
  - **Apple callback:** Same logic as Google.

**Result:** Users who requested deletion can log in again during the 15-day window and cancel deletion.

---

### 1.2 AuthGuard for pending-deletion users

**Problem:** Even if login were fixed, the global `AuthGuard` could reject requests for users with `isActive === false`, so endpoints like `GET /settings/account` and `POST /settings/cancel-deletion` would return 401 for a logged-in user in the pending-deletion window.

**Fix:** In the guard, when `!user.isActive`, allow the request only if `user.deletedAt` exists and `user.deletedAt > now`. Otherwise reject with `UnauthorizedException`.

**Files changed:**

- **`src/common/guards/auth.guard.ts`**
  - User load already includes `deletedAt`.
  - If `!user.isActive`, check `user.deletedAt && user.deletedAt > now`; if true, set `request.user = user` and return `true`. If false, throw `UnauthorizedException`.

**Result:** Authenticated users in the pending-deletion window can access settings (e.g. account, cancel-deletion) as intended.

---

## 2. Settings Module

### 2.1 POST /settings/blocked-users response status

**Problem:** The spec required `POST /settings/blocked-users` to return **200 OK**. NestJS defaults to **201 Created** for `@Post()` handlers.

**Fix:** Force 200 for the block-user endpoint.

**Files changed:**

- **`src/modules/settings/settings.controller.ts`**
  - Added `@HttpCode(HttpStatus.OK)` and imports `HttpCode`, `HttpStatus` from `@nestjs/common` on the `blockUser` handler.

**Result:** Block user returns 200 as specified.

---

### 2.2 Settings controller TypeScript (decorated signature)

**Problem:** Using `Request` from `express` in a decorated parameter type caused TS1272 when `isolatedModules` and `emitDecoratorMetadata` are enabled: *A type referenced in a decorated signature must be imported with 'import type' or a namespace import*.

**Fix:** Use a type-only import for `Request` so it is not emitted in metadata.

**Files changed:**

- **`src/modules/settings/settings.controller.ts`**
  - Replaced `import { Request } from 'express'` with `import type { Request } from 'express'`.

**Result:** Build succeeds without TS1272.

---

## 3. Admin Module

### 3.1 Admin updateUser payload handling

**Problem:** Updating a user via `PATCH /admin/users/:id` with a DTO (e.g. only `role` or only `isActive`) could use an invalid update payload (e.g. incorrectly filtering or spreading the DTO) and cause runtime or type errors.

**Fix:** Build a `Prisma.UserUpdateInput` object and assign only defined DTO fields (`role`, `isActive`). Pass this object to `prisma.user.update`.

**Files changed:**

- **`src/modules/admin/admin.service.ts`**
  - In `updateUser`, define `data: Prisma.UserUpdateInput = {}`.
  - Set `data.role = dto.role` only if `dto.role !== undefined`.
  - Set `data.isActive = dto.isActive` only if `dto.isActive !== undefined`.
  - Call `prisma.user.update({ where: { id: userId }, data })`.

**Result:** Admin user updates work correctly with partial payloads.

---

## 4. Blocked-User Checks (Security / Behavior)

Blocked-user checks were added or confirmed so that blocked users cannot interact in ways the product specifies.

### 4.1 Feed — like and comment

**Files:** `src/modules/feed/feed.service.ts`

- **Toggle like:** If the **post author** has blocked the liker, do not create a like; return current `liked: false` and `likesCount` (idempotent, no error).
- **Add comment:** If the **post author** has blocked the commenter, throw `ForbiddenException` with a clear message (e.g. "You cannot comment on this post.").

### 4.2 Community — answer question

**Problem:** A user could answer a question even when the question author had blocked them.

**Fix:** Before creating an answer, check if the question author has blocked the answerer. If so, throw `ForbiddenException`.

**Files changed:**

- **`src/modules/community/community.service.ts`**
  - In `createAnswer`, load the question with `authorId`.
  - Query `BlockedUser` where `blockerId === question.authorId` and `blockedId === userId`.
  - If found, throw `ForbiddenException` (e.g. "You cannot answer this question.").
  - Added `ForbiddenException` to imports.

### 4.3 Housing — mark interest on listing

**Problem:** A user could mark interest on a listing when the **listing owner** had blocked them (owner should not see interest from a blocked user).

**Fix:** Before creating an interest, check if the listing owner has blocked the current user. If so, throw `NotFoundException` so the listing appears unavailable (e.g. "Listing not found").

**Files changed:**

- **`src/modules/housing/housing.service.ts`**
  - In `markInterest`, after validating the listing and “cannot mark own listing”, query `BlockedUser` where `blockerId === listing.ownerId` and `blockedId === userId`.
  - If found, throw `NotFoundException` with a generic message (e.g. "Listing not found").

### 4.4 Food — submit restaurant review

**Problem:** A user could submit a review on a restaurant when the **restaurant owner** had blocked them.

**Fix:** Before creating a review, check if the restaurant owner has blocked the reviewer. If so, throw `ForbiddenException`.

**Files changed:**

- **`src/modules/food/food.service.ts`**
  - In `submitReview`, after “cannot review own restaurant”, query `BlockedUser` where `blockerId === restaurant.ownerId` and `blockedId === userId`.
  - If found, throw `ForbiddenException` (e.g. "You cannot review this restaurant.").  
  - `ForbiddenException` was already imported.

---

## 5. Security Hardening (UGC & Uploads)

### 5.1 Sanitize user-generated content (XSS)

**Problem:** User-supplied text (e.g. post title, content, comment body, message content) could contain HTML/script and lead to XSS when rendered.

**Fix:** Use a shared `sanitizeInput()` (e.g. via `sanitize-html` with no allowed tags) and apply it to UGC before persisting.

**Files changed:**

- **`src/common/utils/sanitize.ts`** (existing)
  - `sanitizeInput(text)` strips HTML and trims.

- **`src/modules/feed/feed.service.ts`**
  - Import `sanitizeInput`.
  - In `createFeedPost`: sanitize `title`, `content`, `location`, `sourceLabel`, and each element of `tags`.
  - In `updateFeedPost`: sanitize any provided `title`, `content`, `location`, `sourceLabel`, and `tags`.
  - In `addComment`: sanitize `dto.content` before creating the comment.

- **`src/modules/messaging/messaging.service.ts`**
  - Import `sanitizeInput`.
  - In `sendMessage` (REST): set message `content` to `sanitizeInput(String(dto.content))` when content is present (empty string when not).

**Result:** Stored UGC in these flows does not contain HTML/script (e.g. post title `"Test <script>alert('xss')</script> Post"` is stored as `"Test  Post"`).

### 5.2 File upload magic-byte validation

**Problem:** File type was taken from the client (e.g. extension / `mimetype`), which can be spoofed. A non-image could be uploaded as an image.

**Fix:** In the file upload path, validate the file content using magic bytes and reject or correct the stored MIME type accordingly.

**Files changed:**

- **`src/modules/files/files.service.ts`**
  - Read the buffer and detect MIME from magic bytes (e.g. JPEG, PNG, GIF, PDF, WebP, MP4, WebM).
  - If no match or detected type not in the allowed list, throw `BadRequestException` with code `FILE_INVALID_TYPE` and message like "File type does not match its content. Upload rejected."
  - Store the **detected** MIME type, not the client-declared one.

**Result:** Uploading a text file renamed to `.jpg` to `POST /api/users/me/avatar` returns 400 with `FILE_INVALID_TYPE`.

---

## 6. Summary Table

| Area | Issue | Fix |
|------|--------|-----|
| Auth | Login rejected during 15-day deletion window | Allow login when `deletedAt > now()` in auth.service (local, Google, Apple) |
| AuthGuard | Inactive user rejected even when pending deletion | Allow request when `!isActive` but `deletedAt > now()` in auth.guard |
| Settings | Block user returned 201 | `@HttpCode(HttpStatus.OK)` on POST blocked-users |
| Settings | TS1272 on Request type | `import type { Request }` in settings.controller |
| Admin | updateUser with partial DTO | Build `Prisma.UserUpdateInput` with only defined fields |
| Community | Blocked user could answer question | Check blocker in createAnswer → ForbiddenException |
| Housing | Blocked user could mark interest | Check blocker in markInterest → NotFoundException |
| Food | Blocked user could review restaurant | Check blocker in submitReview → ForbiddenException |
| Feed / Messaging | UGC could contain HTML/script | sanitizeInput on post title/content/tags, comment content, message content |
| Files | Upload type spoofable | Magic-byte validation; reject or correct MIME in files.service |

---

*Last updated after Sprint 10 validation and related fixes.*
