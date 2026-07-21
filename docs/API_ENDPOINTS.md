# ComLinkr Backend API Endpoints

> Extracted from NestJS controllers + DTO classes in `backend/src`.
> **Global prefix:** `/api` · **Default port:** `4000` · **Swagger UI:** `/api/docs`

## Conventions

| Auth | Meaning |
|------|---------|
| **Public** | Marked `@Public()` — no session required |
| **Auth** | Requires valid session cookie (global `AuthGuard`) |
| **Admin** | Requires authenticated user with `ADMIN` role (`RolesGuard`) |

| Note | Detail |
|------|--------|
| Session | Cookie-based (`express-session` + Redis). Mobile sends `Cookie: comlinkr.sid=...` |
| Response wrap | Global `TransformInterceptor` wraps payloads |
| Onboarding | `OnboardingGuard` may block incomplete profiles on authenticated routes |
| Validation | Global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) |
| Parameters | Path / query / body fields below are resolved from controller signatures and DTO class properties (including `PartialType` / `OmitType` inheritance) |

## Quick index

| Module | Base path | Count |
|--------|-----------|-------|
| App / Health | `/api` | 1 |
| Auth | `/api/auth` | 13 |
| Users | `/api/users` | 16 |
| Onboarding | `/api/onboarding` | 9 |
| Feed | `/api/feed` | 12 |
| Community | `/api/community` | 11 |
| Events | `/api/events` | 24 |
| Housing | `/api/housing` | 15 |
| Roommates | `/api/roommates` | 15 |
| Food / Restaurants | `/api/restaurants` | 23 |
| Shared Spaces | `/api/shared-spaces` | 10 |
| Stories | `/api/stories` | 12 |
| News | `/api/news` | 7 |
| Challenges | `/api/challenges` | 4 |
| Badges | `/api/badges` | 7 |
| Messaging / Conversations | `/api/conversations` | 10 |
| Notifications | `/api/notifications` | 10 |
| Saves | `/api/saves` | 1 |
| Settings | `/api/settings` | 12 |
| Admin | `/api/admin` | 43 |

**Total: 255 endpoints**

---

## All endpoints

| # | Method | Path | Auth | Parameters | Summary |
|---|--------|------|------|------------|----------|
| 1 | `GET` | `/api/health` | Public | — | Health check |
| 2 | `POST` | `/api/auth/register/initiate` | Public | body: RegisterInitiateDto | Start registration, send OTP |
| 3 | `POST` | `/api/auth/register/verify` | Public | body: RegisterVerifyDto | Verify OTP and create account |
| 4 | `POST` | `/api/auth/login` | Public | body: LoginDto | Login with email/username and password |
| 5 | `POST` | `/api/auth/google` | Public | body: GoogleAuthDto | Google OAuth login/register |
| 6 | `POST` | `/api/auth/google/complete` | Public | body: GoogleCompleteDto | Complete Google registration with username |
| 7 | `POST` | `/api/auth/apple` | Public | body: AppleAuthDto | Apple OAuth login/register |
| 8 | `POST` | `/api/auth/apple/complete` | Public | body: AppleCompleteDto | Complete Apple registration with username |
| 9 | `POST` | `/api/auth/logout` | Auth | — | Destroy session and clear cookie |
| 10 | `GET` | `/api/auth/me` | Auth | — | Get current user from session |
| 11 | `GET` | `/api/auth/providers` | Auth | — | List linked auth providers |
| 12 | `DELETE` | `/api/auth/providers/:provider` | Auth | path: provider | Unlink an auth provider |
| 13 | `POST` | `/api/auth/forgot-password` | Public | body: ForgotPasswordDto | Send password reset OTP |
| 14 | `POST` | `/api/auth/reset-password` | Public | body: ResetPasswordDto | Reset password with OTP |
| 15 | `GET` | `/api/users/me` | Auth | — | Get full profile (relations, stats, achievements) |
| 16 | `PATCH` | `/api/users/me` | Auth | body: UpdateProfileDto | Update basic profile fields |
| 17 | `POST` | `/api/users/me/avatar` | Auth | multipart | Upload profile photo |
| 18 | `DELETE` | `/api/users/me/avatar` | Auth | — | Remove profile photo |
| 19 | `GET` | `/api/users/me/stats` | Auth | — | Get profile stats only |
| 20 | `GET` | `/api/users/me/achievements` | Auth | — | Get achievement badges only |
| 21 | `GET` | `/api/users/me/reservations` | Auth | — | Get all reservations made by the current user |
| 22 | `GET` | `/api/users/me/posts` | Auth | query: PaginationDto | All content by current user (unified) |
| 23 | `POST` | `/api/users/push-token` | Auth | body: UserRegisterPushTokenDto | registerPushToken |
| 24 | `DELETE` | `/api/users/push-token` | Auth | body: UserRegisterPushTokenDto | removePushToken |
| 25 | `POST` | `/api/users/support` | Auth | body: CreateSupportTicketDto | createSupportTicket |
| 26 | `GET` | `/api/users/support` | Auth | — | getMySupportTickets |
| 27 | `GET` | `/api/users/:username/by-username` | Auth | path: username | Get public profile by username |
| 28 | `POST` | `/api/users/:id/block` | Auth | path: id | Block a user by ID |
| 29 | `DELETE` | `/api/users/:id/block` | Auth | path: id | Unblock a user by ID |
| 30 | `GET` | `/api/users/:id` | Auth | path: id | Get public profile by ID |
| 31 | `GET` | `/api/onboarding/vibes` | Auth | — | List all vibes |
| 32 | `GET` | `/api/onboarding/interests` | Auth | — | List all interests |
| 33 | `GET` | `/api/onboarding/communities` | Auth | — | List all communities by category |
| 34 | `POST` | `/api/onboarding/location` | Auth | body: SetLocationDto | Step 1: Set user location |
| 35 | `POST` | `/api/onboarding/vibes` | Auth | body: SetVibesDto | Step 2: Set user vibes |
| 36 | `POST` | `/api/onboarding/interests` | Auth | body: SetInterestsDto | Step 3: Set user interests |
| 37 | `POST` | `/api/onboarding/communities` | Auth | body: SetCommunitiesDto | Step 4: Set user communities |
| 38 | `POST` | `/api/onboarding/agreement` | Auth | body: AcceptAgreementDto | Step 5: Accept ToS and policies |
| 39 | `POST` | `/api/onboarding/complete` | Auth | — | Step 6: Mark onboarding complete |
| 40 | `GET` | `/api/feed` | OptionalAuth | query: FeedQueryDto | Get city-scoped feed with optional category/trending filters |
| 41 | `GET` | `/api/feed/mood` | OptionalAuth | query: NeighborhoodMoodQueryDto | Get neighborhood mood distribution for current city |
| 42 | `POST` | `/api/feed/mood` | Auth | body: VoteNeighborhoodMoodDto | Vote your neighborhood mood for current city |
| 43 | `GET` | `/api/feed/saved` | Auth | query: PaginationDto | Get saved/bookmarked posts for current user |
| 44 | `GET` | `/api/feed/:id` | OptionalAuth | path: id | Get single feed post by ID |
| 45 | `POST` | `/api/feed` | Auth | body: CreateFeedPostDto · multipart | Create news feed post with optional media |
| 46 | `PATCH` | `/api/feed/:id` | Auth | path: id · body: UpdateFeedPostDto | Partially update an owned feed post |
| 47 | `DELETE` | `/api/feed/:id` | Auth | path: id | Delete own feed post |
| 48 | `POST` | `/api/feed/:id/like` | Auth | path: id | Toggle like on a post |
| 49 | `POST` | `/api/feed/:id/comment` | Auth | path: id · body: CreateCommentDto | Add comment to a post |
| 50 | `GET` | `/api/feed/:id/comments` | OptionalAuth | path: id · query: PaginationDto | Get paginated comments for a post |
| 51 | `POST` | `/api/feed/:id/save` | Auth | path: id | Toggle save/bookmark on a post |
| 52 | `GET` | `/api/community/polls` | OptionalAuth | query: city | Active Would You Rather–style polls for your city |
| 53 | `POST` | `/api/community/polls/:id/vote` | Auth | path: id · body: VotePollDto | Vote, change vote, or clear vote (same option again removes your vote) |
| 54 | `GET` | `/api/community/questions` | OptionalAuth | query: CommunityQueryDto | Get paginated city-scoped community questions |
| 55 | `GET` | `/api/community/questions/saved` | Auth | query: PaginationDto | getSavedQuestions |
| 56 | `GET` | `/api/community/stats` | OptionalAuth | query: CommunityStatsQueryDto | Get community stats for a city (or user profile city) |
| 57 | `GET` | `/api/community/questions/:id` | OptionalAuth | path: id | Get question detail with answers |
| 58 | `POST` | `/api/community/questions` | Auth | body: CreateQuestionDto | Create a community question |
| 59 | `POST` | `/api/community/questions/:id/answers` | Auth | path: id · body: CreateAnswerDto | Create an answer for a question |
| 60 | `POST` | `/api/community/questions/:id/upvote` | Auth | path: id | Toggle upvote on a question |
| 61 | `POST` | `/api/community/questions/:id/save` | Auth | path: id | Toggle save/bookmark on a question |
| 62 | `POST` | `/api/community/answers/:id/upvote` | Auth | path: id | Toggle upvote on an answer |
| 63 | `GET` | `/api/events/stories` | Auth | query: city | Lightweight events for feed story strip |
| 64 | `GET` | `/api/events/me` | Auth | — | Events created by current user |
| 65 | `GET` | `/api/events/registered` | Auth | — | Events the user is attending |
| 66 | `GET` | `/api/events/saved` | Auth | query: PaginationDto | getSaved |
| 67 | `GET` | `/api/events` | OptionalAuth | query: EventsQueryDto | List events with filters |
| 68 | `POST` | `/api/events` | Auth | body: CreateEventDto | Create event |
| 69 | `POST` | `/api/events/:id/images` | Auth | path: id · multipart | Upload event cover images (host only) |
| 70 | `GET` | `/api/events/:id/reviews` | OptionalAuth | path: id · query: PaginationDto | Get paginated reviews for an event |
| 71 | `POST` | `/api/events/:id/reviews` | Auth | path: id · body: CreateEventReviewDto | Submit an attendee review after an event |
| 72 | `PATCH` | `/api/events/:id/reviews/:reviewId` | Auth | path: id, reviewId · body: UpdateEventReviewDto | Edit own event review |
| 73 | `DELETE` | `/api/events/:id/reviews/:reviewId` | Auth | path: id, reviewId | Delete an event review as author or event organiser |
| 74 | `POST` | `/api/events/:id/check-in` | Auth | path: id · body: CheckInTicketDto | checkInTicket |
| 75 | `GET` | `/api/events/:id/check-in` | Auth | path: id · query: EventCheckInStatusDto | Get organiser check-in totals and registrations |
| 76 | `GET` | `/api/events/:id` | OptionalAuth | path: id | Get event by ID |
| 77 | `PATCH` | `/api/events/:id` | Auth | path: id · body: UpdateEventDto | Update own event |
| 78 | `DELETE` | `/api/events/:id` | Auth | path: id | Delete own event |
| 79 | `POST` | `/api/events/:id/attend` | Auth | path: id · body: AttendEventDto | RSVP to event |
| 80 | `DELETE` | `/api/events/:id/attend` | Auth | path: id | Cancel RSVP |
| 81 | `POST` | `/api/events/:id/register` | Auth | path: id · body: AttendEventDto | Register for event (alias of attend; mobile) |
| 82 | `DELETE` | `/api/events/:id/register` | Auth | path: id | Cancel registration (alias of cancel attend) |
| 83 | `POST` | `/api/events/:id/save` | Auth | path: id | Toggle saved / bookmark |
| 84 | `POST` | `/api/events/:id/report` | Auth | path: id · body: EventReportReasonDto | Report an event |
| 85 | `GET` | `/api/events/:id/attendees` | Auth | path: id | List attendees (host only) |
| 86 | `GET` | `/api/events/:id/ticket` | Auth | path: id | Current user ticket stub (after registration) |
| 87 | `GET` | `/api/housing` | OptionalAuth | query: HousingQueryDto | List housing listings with filters |
| 88 | `GET` | `/api/housing/my-listings` | Auth | query: PaginationDto | getMyListings |
| 89 | `GET` | `/api/housing/interested` | Auth | query: PaginationDto | Listings the current user marked interest in |
| 90 | `GET` | `/api/housing/saved` | Auth | query: PaginationDto | getSavedListings |
| 91 | `GET` | `/api/housing/:id` | OptionalAuth | path: id | Get listing by ID |
| 92 | `POST` | `/api/housing/:id/report` | Auth | path: id · body: CreateListingReportDto | Report a housing listing |
| 93 | `POST` | `/api/housing` | Auth | body: CreateListingDto | Create listing (verified landlord/agency badge adds trust on the listing) |
| 94 | `PATCH` | `/api/housing/:id` | Auth | path: id · body: UpdateListingDto | Partially update an owned housing listing |
| 95 | `POST` | `/api/housing/:id/images` | Auth | path: id · multipart | Append images to an owned listing |
| 96 | `DELETE` | `/api/housing/:id/images/:imageId` | Auth | path: id, imageId | Remove one image from an owned listing |
| 97 | `PATCH` | `/api/housing/:id/images/reorder` | Auth | path: id · body: ReorderListingImagesDto | Set the complete image order for an owned listing |
| 98 | `DELETE` | `/api/housing/:id` | Auth | path: id | Delete own listing |
| 99 | `POST` | `/api/housing/:id/interest` | Auth | path: id | Mark interest on listing |
| 100 | `DELETE` | `/api/housing/:id/interest` | Auth | path: id | Remove interest from listing |
| 101 | `POST` | `/api/housing/:id/save` | Auth | path: id | Toggle save/bookmark on a listing |
| 102 | `GET` | `/api/roommates/matches` | Auth | query: RoommatesQueryDto | AI-style best-match list (same as search with sort=best_match) |
| 103 | `GET` | `/api/roommates/preferences` | Auth | — | Get roommate search preferences |
| 104 | `GET` | `/api/roommates/listing/me` | Auth | — | Current user roommate listing (if isLooking) |
| 105 | `POST` | `/api/roommates/listing` | Auth | body: CreateRoommateListingDto | Publish roommate listing (sets isLooking) |
| 106 | `PATCH` | `/api/roommates/listing` | Auth | body: PatchRoommateListingDto | Update roommate listing |
| 107 | `DELETE` | `/api/roommates/listing` | Auth | — | Remove roommate listing (isLooking=false) |
| 108 | `GET` | `/api/roommates` | Auth | query: RoommatesQueryDto | Search roommates with filters and sort |
| 109 | `GET` | `/api/roommates/saved` | Auth | query: PaginationDto | getSavedRoommates |
| 110 | `PATCH` | `/api/roommates/preferences` | Auth | body: UpdatePreferencesDto | Update own roommate preferences |
| 111 | `GET` | `/api/roommates/:id` | Auth | path: id | Get roommate profile with compatibility |
| 112 | `POST` | `/api/roommates/:id/save` | Auth | path: id | Toggle save/bookmark on a roommate profile |
| 113 | `POST` | `/api/roommates/:id/connect` | Auth | path: id | Send connection request / start conversation |
| 114 | `POST` | `/api/roommates/:id/cancel` | Auth | path: id | Cancel outgoing roommate connection request |
| 115 | `POST` | `/api/roommates/:id/accept` | Auth | path: id | Accept incoming roommate connection request from user :id |
| 116 | `POST` | `/api/roommates/:id/decline` | Auth | path: id | Decline incoming roommate connection request from user :id |
| 117 | `GET` | `/api/restaurants` | OptionalAuth | query: RestaurantQueryDto | List restaurants with filters |
| 118 | `GET` | `/api/restaurants/my-restaurants` | Auth | query: PaginationDto | getMyRestaurants |
| 119 | `GET` | `/api/restaurants/favorites` | Auth | query: PaginationDto | getFavorites |
| 120 | `GET` | `/api/restaurants/saved` | Auth | query: PaginationDto | getSavedRestaurants |
| 121 | `PATCH` | `/api/restaurants/reservations/:reservationId/cancel` | Auth | path: reservationId | Cancel a reservation (reserver or restaurant owner) |
| 122 | `PATCH` | `/api/restaurants/reservations/:reservationId/confirm` | Auth | path: reservationId | Confirm a pending reservation (owner only) |
| 123 | `GET` | `/api/restaurants/:id/reviews` | OptionalAuth | path: id · query: PaginationDto | Get paginated reviews for a restaurant |
| 124 | `PATCH` | `/api/restaurants/:id/reviews` | Auth | path: id · body: UpdateReviewDto | Edit own review |
| 125 | `DELETE` | `/api/restaurants/:id/reviews` | Auth | path: id | Delete own review |
| 126 | `POST` | `/api/restaurants/:id/reservations` | Auth | path: id · body: CreateReservationDto | Create a reservation at a restaurant |
| 127 | `GET` | `/api/restaurants/:id/reservations` | Auth | path: id · query: status | List reservations for a restaurant (owner only) |
| 128 | `GET` | `/api/restaurants/:id` | OptionalAuth | path: id | Get restaurant by ID |
| 129 | `POST` | `/api/restaurants` | Auth | body: CreateRestaurantDto | Create restaurant (verified owner badge adds trust on the listing) |
| 130 | `PATCH` | `/api/restaurants/:id` | Auth | path: id · body: UpdateRestaurantDto | Update own restaurant |
| 131 | `DELETE` | `/api/restaurants/:id` | Auth | path: id | Delete own restaurant |
| 132 | `POST` | `/api/restaurants/:id/images` | Auth | path: id · multipart | Upload restaurant images |
| 133 | `POST` | `/api/restaurants/:id/reviews` | Auth | path: id · body: CreateReviewDto | Submit a review |
| 134 | `POST` | `/api/restaurants/:id/review` | Auth | path: id · body: CreateReviewDto | Submit a review (alias of POST …/reviews) |
| 135 | `POST` | `/api/restaurants/:id/reserve` | Auth | path: id · body: CreateReservationDto | Make a reservation |
| 136 | `POST` | `/api/restaurants/:id/favorite` | Auth | path: id | Toggle favorite |
| 137 | `POST` | `/api/restaurants/:id/save` | Auth | path: id | Toggle save/bookmark on a restaurant |
| 138 | `POST` | `/api/restaurants/:id/order` | Auth | path: id | Start conversation with owner (mobile “order”) |
| 139 | `POST` | `/api/restaurants/:id/report` | Auth | path: id · body: FoodReportReasonDto | Report a restaurant |
| 140 | `GET` | `/api/shared-spaces` | Auth | query: SharedSpacesQueryDto | List shared spaces (paginated) |
| 141 | `GET` | `/api/shared-spaces/me` | Auth | — | Current user shared spaces |
| 142 | `GET` | `/api/shared-spaces/:id` | Auth | path: id | Get shared space by id |
| 143 | `POST` | `/api/shared-spaces` | Auth | body: CreateSharedSpaceDto | Create shared space |
| 144 | `PATCH` | `/api/shared-spaces/:id` | Auth | path: id · body: UpdateSharedSpaceDto | Update own shared space |
| 145 | `DELETE` | `/api/shared-spaces/:id` | Auth | path: id | Delete own shared space |
| 146 | `POST` | `/api/shared-spaces/:id/images` | Auth | path: id · multipart | Upload shared space images |
| 147 | `DELETE` | `/api/shared-spaces/:id/images/:imageId` | Auth | path: id, imageId | Remove a shared space image |
| 148 | `POST` | `/api/shared-spaces/:id/apply` | Auth | path: id · body: ApplySharedSpaceDto | Apply to join shared space |
| 149 | `POST` | `/api/shared-spaces/:id/save` | Auth | path: id | Toggle save / bookmark |
| 150 | `POST` | `/api/stories` | Auth | body: CreateStoryDto · multipart | Create story (multipart: fields + media) |
| 151 | `GET` | `/api/stories/me` | Auth | — | Current user’s active stories |
| 152 | `GET` | `/api/stories/saved` | Auth | query: PaginationDto | getSavedStories |
| 153 | `GET` | `/api/stories` | OptionalAuth | query: city | getActiveStories |
| 154 | `GET` | `/api/stories/:id/comments` | Public | path: id · query: PaginationDto | Paginated comments for a story |
| 155 | `POST` | `/api/stories/:id/comments` | Auth | path: id · body: AddStoryCommentDto | Add a comment to a story |
| 156 | `DELETE` | `/api/stories/:id/comments/:commentId` | Auth | path: id, commentId | Delete a story comment |
| 157 | `POST` | `/api/stories/:id/like` | Auth | path: id | Toggle like on a story |
| 158 | `GET` | `/api/stories/:id/like` | OptionalAuth | path: id | Get story like count + liked-by-me state |
| 159 | `GET` | `/api/stories/:id` | OptionalAuth | path: id | View a story (increments view count) |
| 160 | `POST` | `/api/stories/:id/save` | Auth | path: id | Toggle save/bookmark on a story |
| 161 | `DELETE` | `/api/stories/:id` | Auth | path: id | Delete own story (before or after expiry if still stored) |
| 162 | `GET` | `/api/news/explore` | OptionalAuth | query: NewsExploreQueryDto | Aggregated live news for Explore (Google News RSS via server — same mix as mobile) |
| 163 | `GET` | `/api/news/articles/saved` | Auth | query: PaginationDto | getSavedArticles |
| 164 | `GET` | `/api/news/articles/:id/stats` | OptionalAuth | path: id | getArticleStats |
| 165 | `POST` | `/api/news/articles/:id/save` | Auth | path: id · body: SaveNewsArticleDto | toggleArticleSave |
| 166 | `POST` | `/api/news/articles/:id/like` | Auth | path: id | toggleArticleLike |
| 167 | `GET` | `/api/news/articles/:id/comments` | Auth | path: id · query: PaginationDto | getArticleComments |
| 168 | `POST` | `/api/news/articles/:id/comments` | Auth | path: id · body: AddNewsCommentDto | addArticleComment |
| 169 | `GET` | `/api/challenges` | OptionalAuth | query: ChallengesQueryDto | List challenges with filters |
| 170 | `POST` | `/api/challenges` | Auth | body: CreateChallengeDto | Create challenge |
| 171 | `GET` | `/api/challenges/:id` | OptionalAuth | path: id | Get challenge by ID with participants |
| 172 | `POST` | `/api/challenges/:id/join` | Auth | path: id | Join challenge |
| 173 | `GET` | `/api/badges/types` | Auth | — | getBadgeTypes |
| 174 | `GET` | `/api/badges/my-status` | Auth | — | getMyBadgeStatus |
| 175 | `GET` | `/api/badges/my-applications` | Auth | — | listMyApplications |
| 176 | `DELETE` | `/api/badges/my-applications/:id` | Auth | path: id | withdrawApplication |
| 177 | `POST` | `/api/badges/apply` | Auth | body: ApplyBadgeDto | applyForBadge |
| 178 | `GET` | `/api/badges/applications/:id` | Auth | path: id | getApplicationById |
| 179 | `GET` | `/api/badges/applications/:applicationId/documents/:documentId/url` | Auth | path: applicationId, documentId | getDocumentUrl |
| 180 | `GET` | `/api/conversations` | Auth | query: ConversationsQueryDto | getConversations |
| 181 | `GET` | `/api/conversations/unread-count` | Auth | — | getUnreadCount |
| 182 | `POST` | `/api/conversations` | Auth | body: CreateConversationDto | createConversation |
| 183 | `POST` | `/api/conversations/audio/upload` | Auth | multipart | uploadAudio |
| 184 | `DELETE` | `/api/conversations/:id` | Auth | path: id | hideConversation |
| 185 | `GET` | `/api/conversations/:id` | Auth | path: id | getConversationById |
| 186 | `PATCH` | `/api/conversations/members/:id/status` | Auth | path: id · body: UpdateMemberStatusDto | updateMemberStatus |
| 187 | `GET` | `/api/conversations/:id/messages` | Auth | path: id · query: cursor, limit | getMessages |
| 188 | `POST` | `/api/conversations/:id/messages` | Auth | path: id · body: SendMessageDto · multipart | sendMessage |
| 189 | `PATCH` | `/api/conversations/:id/read` | Auth | path: id | markAsRead |
| 190 | `GET` | `/api/notifications` | Auth | query: PaginationDto | getNotifications |
| 191 | `GET` | `/api/notifications/unread-count` | Auth | — | getUnreadCount |
| 192 | `GET` | `/api/notifications/preferences` | Auth | — | getPreferences |
| 193 | `PATCH` | `/api/notifications/preferences` | Auth | body: UpdateNotificationPreferencesDto | updatePreferences |
| 194 | `POST` | `/api/notifications/push-token` | Auth | body: NotificationRegisterPushTokenDto | registerPushToken |
| 195 | `DELETE` | `/api/notifications/push-token` | Auth | query: token | removePushToken |
| 196 | `PATCH` | `/api/notifications/read-all` | Auth | — | markAllAsRead |
| 197 | `PATCH` | `/api/notifications/:id/read` | Auth | path: id | markAsRead |
| 198 | `DELETE` | `/api/notifications/:id` | Auth | path: id | deleteOne |
| 199 | `DELETE` | `/api/notifications` | Auth | — | deleteAll |
| 200 | `GET` | `/api/saves` | Auth | query: SavesQueryDto | Unified saved items: counts only when |
| 201 | `GET` | `/api/settings/account` | Auth | — | getAccount |
| 202 | `PATCH` | `/api/settings/account` | Auth | body: UpdateAccountDto | updateAccount |
| 203 | `GET` | `/api/settings/privacy` | Auth | — | getPrivacy |
| 204 | `PATCH` | `/api/settings/privacy` | Auth | body: UpdatePrivacyDto | updatePrivacy |
| 205 | `GET` | `/api/settings/blocked-users` | Auth | — | getBlockedUsers |
| 206 | `POST` | `/api/settings/blocked-users` | Auth | body: BlockUserDto | blockUser |
| 207 | `DELETE` | `/api/settings/blocked-users/:userId` | Auth | path: userId | unblockUser |
| 208 | `PATCH` | `/api/settings/city` | Auth | body: UpdateCityDto | updateCity |
| 209 | `PATCH` | `/api/settings/culture` | Auth | body: UpdateCultureDto | updateCulture |
| 210 | `POST` | `/api/settings/delete-account` | Auth | — | requestDeletion |
| 211 | `POST` | `/api/settings/delete-account/immediate` | Auth | — | Immediately and permanently delete account |
| 212 | `POST` | `/api/settings/cancel-deletion` | Auth | — | cancelDeletion |
| 213 | `GET` | `/api/admin/users` | Admin | query: AdminUsersQueryDto | getUsers |
| 214 | `GET` | `/api/admin/analytics` | Admin | — | getAnalytics |
| 215 | `GET` | `/api/admin/reports` | Admin | query: PaginationDto | getReports |
| 216 | `GET` | `/api/admin/feed` | Admin | query: page, pageSize, search, category, published | getFeedPosts |
| 217 | `GET` | `/api/admin/feed/trending` | Admin | query: limit | getTrendingPosts |
| 218 | `PATCH` | `/api/admin/feed/:id/moderate` | Admin | path: id · body: ModerateActionDto | moderateFeedPost |
| 219 | `GET` | `/api/admin/polls` | Admin | query: page, pageSize | getPolls |
| 220 | `POST` | `/api/admin/polls` | Admin | body: CreateAdminPollDto | createPoll |
| 221 | `PATCH` | `/api/admin/polls/:id/toggle` | Admin | path: id | togglePoll |
| 222 | `DELETE` | `/api/admin/polls/:id` | Admin | path: id | deletePoll |
| 223 | `GET` | `/api/admin/community/questions` | Admin | query: page, pageSize, search, category | getCommunityQuestions |
| 224 | `GET` | `/api/admin/community/news` | Admin | query: page, pageSize, search, category | getCommunityNews |
| 225 | `DELETE` | `/api/admin/community/questions/:id` | Admin | path: id | moderateCommunityQuestion |
| 226 | `GET` | `/api/admin/roommates` | Admin | query: page, pageSize, search | getRoommates |
| 227 | `PATCH` | `/api/admin/roommates/:id/moderate` | Admin | path: id · body: ModerateActionDto | moderateRoommate |
| 228 | `GET` | `/api/admin/restaurants` | Admin | query: page, pageSize, search, isVerified | getRestaurants |
| 229 | `PATCH` | `/api/admin/restaurants/:id/moderate` | Admin | path: id · body: ModerateActionDto | moderateRestaurant |
| 230 | `GET` | `/api/admin/listings` | Admin | query: page, pageSize, search, status, propertyType | getListings |
| 231 | `PATCH` | `/api/admin/listings/:id/moderate` | Admin | path: id · body: ModerateActionDto | moderateListing |
| 232 | `GET` | `/api/admin/areas` | Admin | — | getAreas |
| 233 | `GET` | `/api/admin/notifications/broadcasts` | Admin | query: page, pageSize | getBroadcastHistory |
| 234 | `POST` | `/api/admin/notifications/broadcast` | Admin | body: SendBroadcastDto | sendBroadcast |
| 235 | `GET` | `/api/admin/support` | Admin | query: page, pageSize, status | getSupportTickets |
| 236 | `PATCH` | `/api/admin/support/:id/reply` | Admin | path: id · body: ReplyToTicketDto | replyToTicket |
| 237 | `GET` | `/api/admin/sessions` | Admin | query: AdminSessionsQueryDto | List active authenticated sessions |
| 238 | `DELETE` | `/api/admin/sessions/session/:sessionId` | Admin | path: sessionId | Terminate one active session |
| 239 | `DELETE` | `/api/admin/sessions/user/:userId` | Admin | path: userId | Terminate all active sessions for one user |
| 240 | `PATCH` | `/api/admin/reports/:id/dismiss` | Admin | path: id | dismissReport |
| 241 | `DELETE` | `/api/admin/reports/:id/listing` | Admin | path: id | resolveReportAndDeleteListing |
| 242 | `GET` | `/api/admin/settings` | Admin | — | getPlatformSettings |
| 243 | `PATCH` | `/api/admin/settings` | Admin | body: UpdatePlatformSettingsDto | updatePlatformSettings |
| 244 | `GET` | `/api/admin/content` | Admin | query: AdminContentQueryDto | getContent |
| 245 | `GET` | `/api/admin/badges/applications` | Admin | query: PaginationDto | getBadgeApplications |
| 246 | `PATCH` | `/api/admin/badges/applications/:id/approve` | Admin | path: id · body: ApproveBadgeApplicationDto | Approve badge application |
| 247 | `PATCH` | `/api/admin/badges/applications/:id/reject` | Admin | path: id · body: RejectBadgeApplicationDto | Reject badge application |
| 248 | `PATCH` | `/api/admin/badges/applications/:id` | Admin | path: id · body: ReviewBadgeApplicationDto | reviewBadgeApplication |
| 249 | `GET` | `/api/admin/users/:id` | Admin | path: id | getUserById |
| 250 | `PATCH` | `/api/admin/users/:id` | Admin | path: id · body: UpdateUserAdminDto | updateUser |
| 251 | `POST` | `/api/admin/users/:id/warn` | Admin | path: id · body: WarnUserDto | warnUser |
| 252 | `POST` | `/api/admin/users/:id/grant-badge` | Admin | path: id · body: GrantUserBadgeDto | grantUserBadge |
| 253 | `DELETE` | `/api/admin/users/:id/revoke-badge/:type` | Admin | path: id | Revoke a badge from a user |
| 254 | `DELETE` | `/api/admin/users/:id` | Admin | path: id | deleteUser |
| 255 | `PATCH` | `/api/admin/content/:id` | Admin | path: id · body: ModerateContentDto | moderateContent |

---

## App / Health

**Controller:** `app.controller.ts`

### `GET /api/health`

| | |
|---|---|
| **Auth** | Public |
| **Handler** | `health` |
| **Summary** | Health check |

_No path, query, or body parameters._

---

## Auth

**Controller:** `modules/auth/auth.controller.ts`

### `POST /api/auth/register/initiate`

| | |
|---|---|
| **Auth** | Public |
| **Handler** | `registerInitiate` |
| **Summary** | Start registration, send OTP |

**Body** (`RegisterInitiateDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `email` | email string | required | — |
| `password` | string | required | maxLength=100 |
| `fullName` | string | required | maxLength=100 |
| `username` | string | required | maxLength=20 |

### `POST /api/auth/register/verify`

| | |
|---|---|
| **Auth** | Public |
| **Handler** | `registerVerify` |
| **Summary** | Verify OTP and create account |

**Body** (`RegisterVerifyDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `email` | email string | required | — |
| `code` | string | required | — |
| `password` | string | required | maxLength=100 |
| `fullName` | string | required | maxLength=100 |
| `username` | string | required | maxLength=20 |

### `POST /api/auth/login`

| | |
|---|---|
| **Auth** | Public |
| **Handler** | `login` |
| **Summary** | Login with email/username and password |

**Body** (`LoginDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `identifier` | string | required | Email or username |
| `password` | string | required | — |

### `POST /api/auth/google`

| | |
|---|---|
| **Auth** | Public |
| **Handler** | `googleAuth` |
| **Summary** | Google OAuth login/register |

**Body** (`GoogleAuthDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `idToken` | string | required | Google ID token from client |

### `POST /api/auth/google/complete`

| | |
|---|---|
| **Auth** | Public |
| **Handler** | `googleComplete` |
| **Summary** | Complete Google registration with username |

**Body** (`GoogleCompleteDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `tempToken` | string | required | — |
| `username` | string | required | maxLength=20 |

### `POST /api/auth/apple`

| | |
|---|---|
| **Auth** | Public |
| **Handler** | `appleAuth` |
| **Summary** | Apple OAuth login/register |

**Body** (`AppleAuthDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `idToken` | string | required | Apple ID token from client |
| `fullName` | string | optional | maxLength=100; Full name (only on first authorization) |
| `name` | AppleStructuredNameDto | optional | — |
| `authorizationCode` | string | optional | — |

### `POST /api/auth/apple/complete`

| | |
|---|---|
| **Auth** | Public |
| **Handler** | `appleComplete` |
| **Summary** | Complete Apple registration with username |

**Body** (`AppleCompleteDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `tempToken` | string | required | — |
| `username` | string | required | maxLength=20 |

### `POST /api/auth/logout`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `logout` |
| **Summary** | Destroy session and clear cookie |

_No path, query, or body parameters._

### `GET /api/auth/me`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMe` |
| **Summary** | Get current user from session |

_No path, query, or body parameters._

### `GET /api/auth/providers`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getProviders` |
| **Summary** | List linked auth providers |

_No path, query, or body parameters._

### `DELETE /api/auth/providers/:provider`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `unlinkProvider` |
| **Summary** | Unlink an auth provider |

**Path parameters**

| Name | Type |
|------|------|
| `provider` | string |

### `POST /api/auth/forgot-password`

| | |
|---|---|
| **Auth** | Public |
| **Handler** | `forgotPassword` |
| **Summary** | Send password reset OTP |

**Body** (`ForgotPasswordDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `email` | email string | required | — |

### `POST /api/auth/reset-password`

| | |
|---|---|
| **Auth** | Public |
| **Handler** | `resetPassword` |
| **Summary** | Reset password with OTP |

**Body** (`ResetPasswordDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `email` | email string | required | — |
| `code` | string | required | — |
| `newPassword` | string | required | maxLength=100 |

---

## Users

**Controller:** `modules/users/users.controller.ts`

### `GET /api/users/me`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMyProfile` |
| **Summary** | Get full profile (relations, stats, achievements) |

_No path, query, or body parameters._

### `PATCH /api/users/me`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updateProfile` |
| **Summary** | Update basic profile fields |

**Body** (`UpdateProfileDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `fullName` | string | optional | maxLength=100; Full name of the user |
| `username` | string | optional | maxLength=20; Unique username |
| `bio` | string | optional | maxLength=200; Short bio, max 200 characters |
| `phoneNumber` | string | optional | maxLength=20; Phone number |

### `POST /api/users/me/avatar`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `uploadAvatar` |
| **Summary** | Upload profile photo |

**Body** (`multipart/form-data`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| file field(s) | `binary` / `binary[]` | required | Uploaded via `FileInterceptor` / `FilesInterceptor` |

### `DELETE /api/users/me/avatar`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `removeAvatar` |
| **Summary** | Remove profile photo |

_No path, query, or body parameters._

### `GET /api/users/me/stats`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMyStats` |
| **Summary** | Get profile stats only |

_No path, query, or body parameters._

### `GET /api/users/me/achievements`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMyAchievements` |
| **Summary** | Get achievement badges only |

_No path, query, or body parameters._

### `GET /api/users/me/reservations`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMyReservations` |
| **Summary** | Get all reservations made by the current user |

_No path, query, or body parameters._

### `GET /api/users/me/posts`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMyPosts` |
| **Summary** | All content by current user (unified) |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `POST /api/users/push-token`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `registerPushToken` |

**Body** (`UserRegisterPushTokenDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `token` | string | required | — |

### `DELETE /api/users/push-token`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `removePushToken` |

**Body** (`UserRegisterPushTokenDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `token` | string | required | — |

### `POST /api/users/support`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createSupportTicket` |

**Body** (`CreateSupportTicketDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `subject` | string | required | maxLength=200 |
| `message` | string | required | maxLength=2000 |

### `GET /api/users/support`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMySupportTickets` |

_No path, query, or body parameters._

### `GET /api/users/:username/by-username`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getUserByUsername` |
| **Summary** | Get public profile by username |

**Path parameters**

| Name | Type |
|------|------|
| `username` | string |

### `POST /api/users/:id/block`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `blockUserById` |
| **Summary** | Block a user by ID |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `DELETE /api/users/:id/block`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `unblockUserById` |
| **Summary** | Unblock a user by ID |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `GET /api/users/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getUserById` |
| **Summary** | Get public profile by ID |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

---

## Onboarding

**Controller:** `modules/onboarding/onboarding.controller.ts`

### `GET /api/onboarding/vibes`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getVibes` |
| **Summary** | List all vibes |

_No path, query, or body parameters._

### `GET /api/onboarding/interests`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getInterests` |
| **Summary** | List all interests |

_No path, query, or body parameters._

### `GET /api/onboarding/communities`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getCommunities` |
| **Summary** | List all communities by category |

_No path, query, or body parameters._

### `POST /api/onboarding/location`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `setLocation` |
| **Summary** | Step 1: Set user location |

**Body** (`SetLocationDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `country` | string | required | maxLength=100; Country name |
| `countryCode` | string | required | ISO country code |
| `dialCode` | string | required | maxLength=6; Dial code e.g. +91 |
| `state` | string | required | maxLength=100; State or province |
| `city` | string | required | maxLength=100; City |

### `POST /api/onboarding/vibes`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `setVibes` |
| **Summary** | Step 2: Set user vibes |

**Body** (`SetVibesDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `vibeIds` | string[] | optional | Selected vibe IDs (0 or more) |

### `POST /api/onboarding/interests`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `setInterests` |
| **Summary** | Step 3: Set user interests |

**Body** (`SetInterestsDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `interestIds` | string[] | required | Selected interest IDs (at least one) |

### `POST /api/onboarding/communities`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `setCommunities` |
| **Summary** | Step 4: Set user communities |

**Body** (`SetCommunitiesDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `communityIds` | string[] | optional | Community IDs to join (can be empty to skip) |

### `POST /api/onboarding/agreement`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `acceptAgreement` |
| **Summary** | Step 5: Accept ToS and policies |

**Body** (`AcceptAgreementDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `accepted` | boolean | required | Must be true to accept Terms, Privacy Policy, and Community Guidelines |

### `POST /api/onboarding/complete`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `completeOnboarding` |
| **Summary** | Step 6: Mark onboarding complete |

_No path, query, or body parameters._

---

## Feed

**Controller:** `modules/feed/feed.controller.ts`

### `GET /api/feed`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getFeed` |
| **Summary** | Get city-scoped feed with optional category/trending filters |

**Query parameters** (`FeedQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |
| `category` | enum:FeedCategory | optional | — |
| `trending` | boolean-string | optional | Whether to sort by trending posts (true/false) |

### `GET /api/feed/mood`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getNeighborhoodMood` |
| **Summary** | Get neighborhood mood distribution for current city |

**Query parameters** (`NeighborhoodMoodQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `city` | string | optional | — |

### `POST /api/feed/mood`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `voteNeighborhoodMood` |
| **Summary** | Vote your neighborhood mood for current city |

**Body** (`VoteNeighborhoodMoodDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `mood` | enum:NeighborhoodMood | required | — |
| `city` | string | optional | — |

### `GET /api/feed/saved`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getSavedPosts` |
| **Summary** | Get saved/bookmarked posts for current user |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/feed/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getFeedPostById` |
| **Summary** | Get single feed post by ID |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/feed`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createFeedPost` |
| **Summary** | Create news feed post with optional media |

**Body** (`CreateFeedPostDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | required | maxLength=120 |
| `content` | string | required | maxLength=2000 |
| `category` | enum:FeedCategory | required | — |
| `tags` | string[] | optional | Tags as array or comma-separated string (e.g. "housing, transit") |
| `location` | string | optional | maxLength=200 |
| `sourceLabel` | string | optional | maxLength=100 |

**Body** (`multipart/form-data`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | required | maxLength=120 |
| `content` | string | required | maxLength=2000 |
| `category` | enum:FeedCategory | required | — |
| `tags` | string[] | optional | Tags as array or comma-separated string (e.g. "housing, transit") |
| `location` | string | optional | maxLength=200 |
| `sourceLabel` | string | optional | maxLength=100 |
| file field(s) | `binary` / `binary[]` | required | Uploaded via `FileInterceptor` / `FilesInterceptor` |

### `PATCH /api/feed/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updateFeedPost` |
| **Summary** | Partially update an owned feed post |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`UpdateFeedPostDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | optional | maxLength=120 |
| `content` | string | optional | maxLength=2000 |
| `category` | enum:FeedCategory | optional | — |
| `tags` | string[] | optional | Tags as array or comma-separated string (e.g. "housing, transit") |
| `location` | string | optional | maxLength=200 |
| `sourceLabel` | string | optional | maxLength=100 |

### `DELETE /api/feed/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteFeedPost` |
| **Summary** | Delete own feed post |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/feed/:id/like`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleLike` |
| **Summary** | Toggle like on a post |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/feed/:id/comment`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `addComment` |
| **Summary** | Add comment to a post |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`CreateCommentDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `content` | string | required | maxLength=500 |

### `GET /api/feed/:id/comments`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getComments` |
| **Summary** | Get paginated comments for a post |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `POST /api/feed/:id/save`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleSave` |
| **Summary** | Toggle save/bookmark on a post |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

---

## Community

**Controller:** `modules/community/community.controller.ts`

### `GET /api/community/polls`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getPolls` |
| **Summary** | Active Would You Rather–style polls for your city |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `city` | string | optional | — |

### `POST /api/community/polls/:id/vote`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `votePoll` |
| **Summary** | Vote, change vote, or clear vote (same option again removes your vote) |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`VotePollDto` — JSON)

_No fields declared (empty / passthrough DTO)._

### `GET /api/community/questions`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getQuestions` |
| **Summary** | Get paginated city-scoped community questions |

**Query parameters** (`CommunityQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |
| `city` | string | optional | — |
| `category` | enum:CommunityQuestionCategory | optional | — |
| `sort` | string | optional | Sort mode: recent (default) or trending |

### `GET /api/community/questions/saved`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getSavedQuestions` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/community/stats`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getCommunityStats` |
| **Summary** | Get community stats for a city (or user profile city) |

**Query parameters** (`CommunityStatsQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `city` | string | optional | City to scope stats (members with this location, Q&A in this city). Defaults to the current user profile city. |

### `GET /api/community/questions/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getQuestionById` |
| **Summary** | Get question detail with answers |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/community/questions`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createQuestion` |
| **Summary** | Create a community question |

**Body** (`CreateQuestionDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | required | maxLength=300 |
| `body` | string | optional | maxLength=2000 |
| `category` | enum:CommunityQuestionCategory | required | — |
| `tags` | string[] | optional | Tags as array or comma-separated string (e.g. "housing, transit") |

### `POST /api/community/questions/:id/answers`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createAnswer` |
| **Summary** | Create an answer for a question |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`CreateAnswerDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `content` | string | required | maxLength=2000 |

### `POST /api/community/questions/:id/upvote`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleQuestionUpvote` |
| **Summary** | Toggle upvote on a question |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/community/questions/:id/save`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleSaveQuestion` |
| **Summary** | Toggle save/bookmark on a question |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/community/answers/:id/upvote`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleAnswerUpvote` |
| **Summary** | Toggle upvote on an answer |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

---

## Events

**Controller:** `modules/events/events.controller.ts`

### `GET /api/events/stories`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getStories` |
| **Summary** | Lightweight events for feed story strip |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `city` | string | optional | — |

### `GET /api/events/me`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMyEvents` |
| **Summary** | Events created by current user |

_No path, query, or body parameters._

### `GET /api/events/registered`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getRegistered` |
| **Summary** | Events the user is attending |

_No path, query, or body parameters._

### `GET /api/events/saved`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getSaved` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/events`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getEvents` |
| **Summary** | List events with filters |

**Query parameters** (`EventsQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |
| `category` | enum:EventCategory | optional | — |
| `format` | enum:EventFormat | optional | — |
| `city` | string | optional | — |
| `date` | ISO date string | optional | — |
| `upcoming` | boolean-string | optional | Only future events |

### `POST /api/events`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createEvent` |
| **Summary** | Create event |

**Body** (`CreateEventDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | required | maxLength=120 |
| `description` | string | required | maxLength=2000 |
| `category` | enum:EventCategory | required | — |
| `format` | enum:EventFormat | required | — |
| `date` | ISO date string | required | — |
| `startTime` | string | required | maxLength=20 |
| `endTime` | string | optional | maxLength=20 |
| `venue` | string | required | maxLength=300 |
| `city` | string | required | maxLength=100 |
| `ticketType` | enum:TicketType | required | default=TicketType.FREE |
| `ticketPrice` | number | optional | min=0 |
| `capacity` | number (int) | optional | min=1 |

### `POST /api/events/:id/images`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `uploadEventImages` |
| **Summary** | Upload event cover images (host only) |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`multipart/form-data`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| file field(s) | `binary` / `binary[]` | required | Uploaded via `FileInterceptor` / `FilesInterceptor` |

### `GET /api/events/:id/reviews`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getEventReviews` |
| **Summary** | Get paginated reviews for an event |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `POST /api/events/:id/reviews`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createEventReview` |
| **Summary** | Submit an attendee review after an event |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`CreateEventReviewDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `rating` | number | required | — |
| `content` | string | required | — |

### `PATCH /api/events/:id/reviews/:reviewId`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updateEventReview` |
| **Summary** | Edit own event review |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |
| `reviewId` | string |

**Body** (`UpdateEventReviewDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `rating` | number | optional | — |
| `content` | string | optional | — |

### `DELETE /api/events/:id/reviews/:reviewId`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteEventReview` |
| **Summary** | Delete an event review as author or event organiser |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |
| `reviewId` | string |

### `POST /api/events/:id/check-in`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `checkInTicket` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`CheckInTicketDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `ticketId` | string | required | — |

### `GET /api/events/:id/check-in`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getEventCheckInStatus` |
| **Summary** | Get organiser check-in totals and registrations |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Query parameters** (`EventCheckInStatusDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |
| `filter` | EventCheckInFilter | optional | — |

### `GET /api/events/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getEventById` |
| **Summary** | Get event by ID |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `PATCH /api/events/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updateEvent` |
| **Summary** | Update own event |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`UpdateEventDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | optional | maxLength=120 |
| `description` | string | optional | maxLength=2000 |
| `category` | enum:EventCategory | optional | — |
| `format` | enum:EventFormat | optional | — |
| `date` | ISO date string | optional | — |
| `startTime` | string | optional | maxLength=20 |
| `endTime` | string | optional | maxLength=20 |
| `venue` | string | optional | maxLength=300 |
| `city` | string | optional | maxLength=100 |
| `ticketType` | enum:TicketType | optional | default=TicketType.FREE |
| `ticketPrice` | number | optional | min=0 |
| `capacity` | number (int) | optional | min=1 |

### `DELETE /api/events/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteEvent` |
| **Summary** | Delete own event |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/events/:id/attend`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `attendEvent` |
| **Summary** | RSVP to event |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`AttendEventDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `attendeeName` | string | optional | maxLength=200 |
| `attendeeEmail` | email string | optional | — |
| `attendeePhone` | string | optional | maxLength=30 |
| `ticketCount` | number (int) | optional | min=1, max=4 |

### `DELETE /api/events/:id/attend`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `cancelAttendance` |
| **Summary** | Cancel RSVP |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/events/:id/register`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `register` |
| **Summary** | Register for event (alias of attend; mobile) |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`AttendEventDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `attendeeName` | string | optional | maxLength=200 |
| `attendeeEmail` | email string | optional | — |
| `attendeePhone` | string | optional | maxLength=30 |
| `ticketCount` | number (int) | optional | min=1, max=4 |

### `DELETE /api/events/:id/register`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `unregister` |
| **Summary** | Cancel registration (alias of cancel attend) |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/events/:id/save`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleSave` |
| **Summary** | Toggle saved / bookmark |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/events/:id/report`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `report` |
| **Summary** | Report an event |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`EventReportReasonDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `reason` | string | required | maxLength=500 |

### `GET /api/events/:id/attendees`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getAttendees` |
| **Summary** | List attendees (host only) |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `GET /api/events/:id/ticket`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getTicket` |
| **Summary** | Current user ticket stub (after registration) |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

---

## Housing

**Controller:** `modules/housing/housing.controller.ts`

### `GET /api/housing`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getListings` |
| **Summary** | List housing listings with filters |

**Query parameters** (`HousingQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |
| `type` | enum:PropertyType | optional | — |
| `minPrice` | number | optional | — |
| `maxPrice` | number | optional | — |
| `beds` | number (int) | optional | — |
| `city` | string | optional | — |
| `search` | string | optional | maxLength=200 |

### `GET /api/housing/my-listings`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMyListings` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/housing/interested`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getInterestedListings` |
| **Summary** | Listings the current user marked interest in |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/housing/saved`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getSavedListings` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/housing/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getListingById` |
| **Summary** | Get listing by ID |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/housing/:id/report`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `reportListing` |
| **Summary** | Report a housing listing |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`CreateListingReportDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `reason` | string | required | maxLength=1000 |

### `POST /api/housing`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createListing` |
| **Summary** | Create listing (verified landlord/agency badge adds trust on the listing) |

**Body** (`CreateListingDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | required | maxLength=120 |
| `description` | string | required | maxLength=5000 |
| `propertyType` | enum:PropertyType | required | — |
| `price` | number | required | — |
| `currency` | string | optional | maxLength=3 |
| `deposit` | number | optional | min=0 |
| `bedrooms` | number (int) | required | min=0 |
| `bathrooms` | number (int) | required | min=0 |
| `sqft` | number (int) | optional | — |
| `floor` | string | optional | maxLength=20 |
| `address` | string | required | maxLength=300 |
| `neighborhood` | string | optional | maxLength=100 |
| `city` | string | required | maxLength=100 |
| `state` | string | optional | maxLength=100 |
| `country` | string | required | maxLength=100 |
| `latitude` | number | optional | — |
| `longitude` | number | optional | — |
| `availableDate` | ISO date string | optional | — |
| `leaseTerm` | string | optional | maxLength=50 |
| `isFurnished` | boolean | optional | — |
| `petPolicy` | string | optional | maxLength=100 |
| `parking` | string | optional | maxLength=100 |
| `laundry` | string | optional | maxLength=100 |
| `heating` | string | optional | maxLength=100 |
| `cooling` | string | optional | maxLength=100 |
| `utilities` | string | optional | maxLength=200 |
| `yearBuilt` | number (int) | optional | min=1800, max=2100 |
| `amenities` | string[] | optional | — |
| `transitInfo` | string | optional | maxLength=200 |
| `walkScore` | number (int) | optional | min=0, max=100 |

### `PATCH /api/housing/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updateListing` |
| **Summary** | Partially update an owned housing listing |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`UpdateListingDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | optional | maxLength=120 |
| `description` | string | optional | maxLength=5000 |
| `propertyType` | enum:PropertyType | optional | — |
| `price` | number | optional | — |
| `currency` | string | optional | maxLength=3 |
| `deposit` | number | optional | min=0 |
| `bedrooms` | number (int) | optional | min=0 |
| `bathrooms` | number (int) | optional | min=0 |
| `sqft` | number (int) | optional | — |
| `floor` | string | optional | maxLength=20 |
| `address` | string | optional | maxLength=300 |
| `neighborhood` | string | optional | maxLength=100 |
| `city` | string | optional | maxLength=100 |
| `state` | string | optional | maxLength=100 |
| `country` | string | optional | maxLength=100 |
| `availableDate` | ISO date string | optional | — |
| `leaseTerm` | string | optional | maxLength=50 |
| `isFurnished` | boolean | optional | — |
| `petPolicy` | string | optional | maxLength=100 |
| `parking` | string | optional | maxLength=100 |
| `laundry` | string | optional | maxLength=100 |
| `heating` | string | optional | maxLength=100 |
| `cooling` | string | optional | maxLength=100 |
| `utilities` | string | optional | maxLength=200 |
| `yearBuilt` | number (int) | optional | min=1800, max=2100 |
| `amenities` | string[] | optional | — |
| `transitInfo` | string | optional | maxLength=200 |
| `walkScore` | number (int) | optional | min=0, max=100 |
| `status` | enum:ListingStatus | optional | — |

### `POST /api/housing/:id/images`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `uploadImages` |
| **Summary** | Append images to an owned listing |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`multipart/form-data`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| file field(s) | `binary` / `binary[]` | required | Uploaded via `FileInterceptor` / `FilesInterceptor` |

### `DELETE /api/housing/:id/images/:imageId`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `removeImage` |
| **Summary** | Remove one image from an owned listing |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |
| `imageId` | string |

### `PATCH /api/housing/:id/images/reorder`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `reorderImages` |
| **Summary** | Set the complete image order for an owned listing |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`ReorderListingImagesDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `imageIds` | string[] | required | — |

### `DELETE /api/housing/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteListing` |
| **Summary** | Delete own listing |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/housing/:id/interest`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `markInterest` |
| **Summary** | Mark interest on listing |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `DELETE /api/housing/:id/interest`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `removeInterest` |
| **Summary** | Remove interest from listing |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/housing/:id/save`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleSave` |
| **Summary** | Toggle save/bookmark on a listing |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

---

## Roommates

**Controller:** `modules/roommates/roommates.controller.ts`

### `GET /api/roommates/matches`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMatches` |
| **Summary** | AI-style best-match list (same as search with sort=best_match) |

**Query parameters** (`RoommatesQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |
| `minBudget` | number (int) | optional | — |
| `maxBudget` | number (int) | optional | — |
| `city` | string | optional | — |

### `GET /api/roommates/preferences`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getPreferences` |
| **Summary** | Get roommate search preferences |

_No path, query, or body parameters._

### `GET /api/roommates/listing/me`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMyListing` |
| **Summary** | Current user roommate listing (if isLooking) |

_No path, query, or body parameters._

### `POST /api/roommates/listing`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createListing` |
| **Summary** | Publish roommate listing (sets isLooking) |

**Body** (`CreateRoommateListingDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `budgetMin` | number (int) | optional | min=0 |
| `budgetMax` | number (int) | optional | min=0 |
| `moveInDate` | ISO date string | optional | — |
| `sleepSchedule` | enum:SleepSchedule | optional | — |
| `cleanliness` | enum:Cleanliness | optional | — |
| `noiseTolerance` | enum:NoiseTolerance | optional | — |
| `petFriendly` | boolean | optional | — |
| `smokingAllowed` | boolean | optional | — |
| `guestsFrequency` | enum:GuestsFrequency | optional | — |
| `workFromHome` | boolean | optional | — |
| `aboutMe` | string | optional | maxLength=500 |
| `isLooking` | boolean | optional | — |
| `city` | string | required | maxLength=100 |
| `stateProvince` | string | optional | maxLength=100 |
| `country` | string | optional | maxLength=100 |
| `occupation` | string | optional | maxLength=120 |

### `PATCH /api/roommates/listing`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `patchListing` |
| **Summary** | Update roommate listing |

**Body** (`PatchRoommateListingDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `budgetMin` | number (int) | optional | min=0 |
| `budgetMax` | number (int) | optional | min=0 |
| `moveInDate` | ISO date string | optional | — |
| `sleepSchedule` | enum:SleepSchedule | optional | — |
| `cleanliness` | enum:Cleanliness | optional | — |
| `noiseTolerance` | enum:NoiseTolerance | optional | — |
| `petFriendly` | boolean | optional | — |
| `smokingAllowed` | boolean | optional | — |
| `guestsFrequency` | enum:GuestsFrequency | optional | — |
| `workFromHome` | boolean | optional | — |
| `aboutMe` | string | optional | maxLength=500 |
| `isLooking` | boolean | optional | — |
| `city` | string | optional | maxLength=100 |
| `stateProvince` | string | optional | maxLength=100 |
| `country` | string | optional | maxLength=100 |
| `occupation` | string | optional | maxLength=120 |

### `DELETE /api/roommates/listing`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteListing` |
| **Summary** | Remove roommate listing (isLooking=false) |

_No path, query, or body parameters._

### `GET /api/roommates`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `searchRoommates` |
| **Summary** | Search roommates with filters and sort |

**Query parameters** (`RoommatesQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |
| `minBudget` | number (int) | optional | — |
| `maxBudget` | number (int) | optional | — |
| `city` | string | optional | — |

### `GET /api/roommates/saved`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getSavedRoommates` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `PATCH /api/roommates/preferences`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updatePreferences` |
| **Summary** | Update own roommate preferences |

**Body** (`UpdatePreferencesDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `budgetMin` | number (int) | optional | min=0 |
| `budgetMax` | number (int) | optional | min=0 |
| `moveInDate` | ISO date string | optional | — |
| `sleepSchedule` | enum:SleepSchedule | optional | — |
| `cleanliness` | enum:Cleanliness | optional | — |
| `noiseTolerance` | enum:NoiseTolerance | optional | — |
| `petFriendly` | boolean | optional | — |
| `smokingAllowed` | boolean | optional | — |
| `guestsFrequency` | enum:GuestsFrequency | optional | — |
| `workFromHome` | boolean | optional | — |
| `aboutMe` | string | optional | maxLength=500 |
| `isLooking` | boolean | optional | — |

### `GET /api/roommates/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getRoommateProfile` |
| **Summary** | Get roommate profile with compatibility |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/roommates/:id/save`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleRoommateSave` |
| **Summary** | Toggle save/bookmark on a roommate profile |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/roommates/:id/connect`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `sendConnectionRequest` |
| **Summary** | Send connection request / start conversation |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/roommates/:id/cancel`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `cancelConnectionRequest` |
| **Summary** | Cancel outgoing roommate connection request |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/roommates/:id/accept`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `acceptConnection` |
| **Summary** | Accept incoming roommate connection request from user :id |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/roommates/:id/decline`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `declineConnection` |
| **Summary** | Decline incoming roommate connection request from user :id |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

---

## Food / Restaurants

**Controller:** `modules/food/food.controller.ts`

### `GET /api/restaurants`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getRestaurants` |
| **Summary** | List restaurants with filters |

**Query parameters** (`RestaurantQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |
| `cuisine` | string | optional | — |
| `priceRange` | enum:PriceRange | optional | — |
| `service` | string | optional | e.g. Dine-in, Takeout, Delivery |
| `city` | string | optional | — |
| `search` | string | optional | maxLength=200 |

### `GET /api/restaurants/my-restaurants`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMyRestaurants` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/restaurants/favorites`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getFavorites` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/restaurants/saved`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getSavedRestaurants` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `PATCH /api/restaurants/reservations/:reservationId/cancel`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `cancelReservation` |
| **Summary** | Cancel a reservation (reserver or restaurant owner) |

**Path parameters**

| Name | Type |
|------|------|
| `reservationId` | string |

### `PATCH /api/restaurants/reservations/:reservationId/confirm`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `confirmReservation` |
| **Summary** | Confirm a pending reservation (owner only) |

**Path parameters**

| Name | Type |
|------|------|
| `reservationId` | string |

### `GET /api/restaurants/:id/reviews`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getReviews` |
| **Summary** | Get paginated reviews for a restaurant |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `PATCH /api/restaurants/:id/reviews`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updateMyReview` |
| **Summary** | Edit own review |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`UpdateReviewDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `rating` | number (int) | optional | min=1, max=5 |
| `content` | string | optional | maxLength=2000 |

### `DELETE /api/restaurants/:id/reviews`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteMyReview` |
| **Summary** | Delete own review |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/restaurants/:id/reservations`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createReservation` |
| **Summary** | Create a reservation at a restaurant |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`CreateReservationDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `partySize` | number (int) | required | min=1, max=20; HH:MM (24-hour) |
| `note` | string | optional | maxLength=500 |

### `GET /api/restaurants/:id/reservations`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getRestaurantReservations` |
| **Summary** | List reservations for a restaurant (owner only) |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `status` | string | optional | — |

### `GET /api/restaurants/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getRestaurantById` |
| **Summary** | Get restaurant by ID |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/restaurants`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createRestaurant` |
| **Summary** | Create restaurant (verified owner badge adds trust on the listing) |

**Body** (`CreateRestaurantDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `name` | string | required | maxLength=200 |
| `cuisine` | string | required | maxLength=100 |
| `description` | string | optional | maxLength=2000 |
| `address` | string | required | maxLength=300 |
| `city` | string | required | maxLength=100 |
| `state` | string | optional | maxLength=100 |
| `country` | string | required | maxLength=100 |
| `latitude` | number | optional | — |
| `longitude` | number | optional | — |
| `phoneNumber` | string | optional | maxLength=20 |
| `priceRange` | enum:PriceRange | required | — |
| `waitTimeMinutes` | number (int) | optional | min=0, { message: 'Average price per person must be a non-negative integer' } |
| `openingTime` | string | optional | maxLength=20 |
| `closingTime` | string | optional | maxLength=20 |
| `availableServices` | string[] | required | e.g. ["Dine-in", "Takeout", "Delivery"] |
| `popularDishes` | PopularDishDto[] | optional | Popular dishes with name and rank |
| `tags` | string[] | optional | — |

### `PATCH /api/restaurants/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updateRestaurant` |
| **Summary** | Update own restaurant |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`UpdateRestaurantDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `name` | string | optional | maxLength=200 |
| `cuisine` | string | optional | maxLength=100 |
| `description` | string | optional | maxLength=2000 |
| `address` | string | optional | maxLength=300 |
| `city` | string | optional | maxLength=100 |
| `state` | string | optional | maxLength=100 |
| `country` | string | optional | maxLength=100 |
| `latitude` | number | optional | — |
| `longitude` | number | optional | — |
| `phoneNumber` | string | optional | maxLength=20 |
| `priceRange` | enum:PriceRange | optional | — |
| `waitTimeMinutes` | number (int) | optional | min=0, { message: 'Average price per person must be a non-negative integer' } |
| `openingTime` | string | optional | maxLength=20 |
| `closingTime` | string | optional | maxLength=20 |
| `availableServices` | string[] | optional | e.g. ["Dine-in", "Takeout", "Delivery"] |
| `popularDishes` | PopularDishDto[] | optional | Popular dishes with name and rank |
| `tags` | string[] | optional | — |
| `isOpen` | boolean | optional | — |

### `DELETE /api/restaurants/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteRestaurant` |
| **Summary** | Delete own restaurant |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/restaurants/:id/images`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `uploadImages` |
| **Summary** | Upload restaurant images |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`multipart/form-data`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| file field(s) | `binary` / `binary[]` | required | Uploaded via `FileInterceptor` / `FilesInterceptor` |

### `POST /api/restaurants/:id/reviews`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `submitReview` |
| **Summary** | Submit a review |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`CreateReviewDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `rating` | number (int) | required | min=1, max=5 |
| `content` | string | required | maxLength=1000 |

### `POST /api/restaurants/:id/review`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `submitReviewAlias` |
| **Summary** | Submit a review (alias of POST …/reviews) |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`CreateReviewDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `rating` | number (int) | required | min=1, max=5 |
| `content` | string | required | maxLength=1000 |

### `POST /api/restaurants/:id/reserve`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `makeReservation` |
| **Summary** | Make a reservation |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`CreateReservationDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `partySize` | number (int) | required | min=1, max=20; HH:MM (24-hour) |
| `note` | string | optional | maxLength=500 |

### `POST /api/restaurants/:id/favorite`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleFavorite` |
| **Summary** | Toggle favorite |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/restaurants/:id/save`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleRestaurantSave` |
| **Summary** | Toggle save/bookmark on a restaurant |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/restaurants/:id/order`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `initiateOrder` |
| **Summary** | Start conversation with owner (mobile “order”) |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/restaurants/:id/report`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `reportRestaurant` |
| **Summary** | Report a restaurant |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`FoodReportReasonDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `reason` | string | required | maxLength=1000 |

---

## Shared Spaces

**Controller:** `modules/shared-spaces/shared-spaces.controller.ts`

### `GET /api/shared-spaces`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `list` |
| **Summary** | List shared spaces (paginated) |

**Query parameters** (`SharedSpacesQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `city` | string | optional | — |
| `maxPrice` | number (int) | optional | min=0 |
| `petFriendly` | string | optional | — |
| `page` | number (int) | optional | min=1 |
| `limit` | number (int) | optional | min=1, max=100 |

### `GET /api/shared-spaces/me`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `mySpaces` |
| **Summary** | Current user shared spaces |

_No path, query, or body parameters._

### `GET /api/shared-spaces/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getOne` |
| **Summary** | Get shared space by id |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/shared-spaces`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `create` |
| **Summary** | Create shared space |

**Body** (`CreateSharedSpaceDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `state` | string | optional | maxLength=120 |
| `latitude` | number | optional | maxLength=100 |
| `longitude` | number | optional | — |
| `currency` | number | optional | maxLength=8, min=0.01 |
| `deposit` | number | optional | min=0 |
| `petPolicy` | number (int) | optional | maxLength=200, min=1 |
| `smoking` | boolean | optional | — |
| `sleepSchedule` | enum:SleepSchedule | optional | — |
| `noiseTolerance` | enum:NoiseTolerance | optional | — |
| `roomType` | enum:RoomType | optional | — |
| `furnishedStatus` | enum:FurnishedStatus | optional | — |
| `availableFrom` | ISO date string | optional | — |
| `cleanliness` | string | optional | maxLength=100 |
| `guestPolicy` | string | optional | maxLength=200 |
| `leaseTerm` | string | optional | maxLength=100 |
| `genderPreference` | string | optional | maxLength=100 |
| `amenities` | string[] | optional | — |
| `houseRules` | string[] | optional | — |

### `PATCH /api/shared-spaces/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `update` |
| **Summary** | Update own shared space |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`UpdateSharedSpaceDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `state` | string | optional | maxLength=120 |
| `latitude` | number | optional | maxLength=100 |
| `longitude` | number | optional | — |
| `currency` | number | optional | maxLength=8, min=0.01 |
| `deposit` | number | optional | min=0 |
| `petPolicy` | number (int) | optional | maxLength=200, min=1 |
| `smoking` | boolean | optional | — |
| `sleepSchedule` | enum:SleepSchedule | optional | — |
| `noiseTolerance` | enum:NoiseTolerance | optional | — |
| `roomType` | enum:RoomType | optional | — |
| `furnishedStatus` | enum:FurnishedStatus | optional | — |
| `availableFrom` | ISO date string | optional | — |
| `cleanliness` | string | optional | maxLength=100 |
| `guestPolicy` | string | optional | maxLength=200 |
| `leaseTerm` | string | optional | maxLength=100 |
| `genderPreference` | string | optional | maxLength=100 |
| `amenities` | string[] | optional | — |
| `houseRules` | string[] | optional | — |

### `DELETE /api/shared-spaces/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `remove` |
| **Summary** | Delete own shared space |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/shared-spaces/:id/images`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `uploadImages` |
| **Summary** | Upload shared space images |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`multipart/form-data`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| file field(s) | `binary` / `binary[]` | required | Uploaded via `FileInterceptor` / `FilesInterceptor` |

### `DELETE /api/shared-spaces/:id/images/:imageId`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `removeImage` |
| **Summary** | Remove a shared space image |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |
| `imageId` | string |

### `POST /api/shared-spaces/:id/apply`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `apply` |
| **Summary** | Apply to join shared space |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`ApplySharedSpaceDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `message` | string | optional | maxLength=500 |

### `POST /api/shared-spaces/:id/save`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleSave` |
| **Summary** | Toggle save / bookmark |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

---

## Stories

**Controller:** `modules/stories/stories.controller.ts`

### `POST /api/stories`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createStory` |
| **Summary** | Create story (multipart: fields + media) |

**Body** (`CreateStoryDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | required | maxLength=120 |
| `mediaType` | enum:StoryMediaType | required | — |
| `category` | enum:StoryCategory | required | — |
| `details` | string | optional | maxLength=500 |
| `hashtags` | string[] | optional | JSON string array, comma-separated tags, or repeated form fields (multipart) |
| `durationSeconds` | number (int) | optional | min=1, max=300 |
| `location` | string | optional | maxLength=200 |

**Body** (`multipart/form-data`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | required | maxLength=120 |
| `mediaType` | enum:StoryMediaType | required | — |
| `category` | enum:StoryCategory | required | — |
| `details` | string | optional | maxLength=500 |
| `hashtags` | string[] | optional | JSON string array, comma-separated tags, or repeated form fields (multipart) |
| `durationSeconds` | number (int) | optional | min=1, max=300 |
| `location` | string | optional | maxLength=200 |
| file field(s) | `binary` / `binary[]` | required | Uploaded via `FileInterceptor` / `FilesInterceptor` |

### `GET /api/stories/me`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMyStories` |
| **Summary** | Current user’s active stories |

_No path, query, or body parameters._

### `GET /api/stories/saved`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getSavedStories` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/stories`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getActiveStories` |

_No path, query, or body parameters._

### `GET /api/stories/:id/comments`

| | |
|---|---|
| **Auth** | Public |
| **Handler** | `getComments` |
| **Summary** | Paginated comments for a story |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `POST /api/stories/:id/comments`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `addComment` |
| **Summary** | Add a comment to a story |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`AddStoryCommentDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `content` | string | required | maxLength=500 |

### `DELETE /api/stories/:id/comments/:commentId`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteComment` |
| **Summary** | Delete a story comment |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |
| `commentId` | string |

### `POST /api/stories/:id/like`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleLike` |
| **Summary** | Toggle like on a story |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `GET /api/stories/:id/like`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getLikeStatus` |
| **Summary** | Get story like count + liked-by-me state |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `GET /api/stories/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `viewStory` |
| **Summary** | View a story (increments view count) |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/stories/:id/save`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleStorySave` |
| **Summary** | Toggle save/bookmark on a story |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `DELETE /api/stories/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteStory` |
| **Summary** | Delete own story (before or after expiry if still stored) |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

---

## News

**Controller:** `modules/news/news.controller.ts`

### `GET /api/news/explore`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `explore` |
| **Summary** | Aggregated live news for Explore (Google News RSS via server — same mix as mobile) |

**Query parameters** (`NewsExploreQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `city` | string | optional | maxLength=120 |
| `country` | string | optional | maxLength=120 |
| `state` | string | optional | maxLength=100; State/region for local news fallback |
| `phase` | 'primary' | 'full' | optional | — |
| `force` | boolean | optional | — |
| `page` | number (int) | optional | min=1 |
| `pageSize` | number (int) | optional | min=1, max=100 |

### `GET /api/news/articles/saved`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getSavedArticles` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/news/articles/:id/stats`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getArticleStats` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/news/articles/:id/save`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleArticleSave` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`SaveNewsArticleDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | required | maxLength=500 |
| `url` | string | required | maxLength=2000 |
| `imageUrl` | string | optional | maxLength=2000 |
| `source` | string | optional | maxLength=200 |
| `publishedAt` | ISO date string | optional | ISO date string |

### `POST /api/news/articles/:id/like`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `toggleArticleLike` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `GET /api/news/articles/:id/comments`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getArticleComments` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `POST /api/news/articles/:id/comments`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `addArticleComment` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`AddNewsCommentDto` — JSON)

_No fields declared (empty / passthrough DTO)._

---

## Challenges

**Controller:** `modules/challenges/challenges.controller.ts`

### `GET /api/challenges`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getChallenges` |
| **Summary** | List challenges with filters |

**Query parameters** (`ChallengesQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |
| `type` | enum:ChallengeType | optional | — |
| `city` | string | optional | — |
| `status` | enum:ChallengeStatus | optional | — |

### `POST /api/challenges`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createChallenge` |
| **Summary** | Create challenge |

**Body** (`CreateChallengeDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | required | maxLength=120 |
| `type` | enum:ChallengeType | required | — |
| `details` | string | optional | maxLength=500 |
| `duration` | enum:ChallengeDuration | required | — |
| `goalCondition` | string | required | maxLength=300 |
| `reward` | string | required | maxLength=300 |
| `maxParticipants` | number (int) | optional | min=1 |
| `hashtags` | string[] | optional | — |
| `location` | string | optional | maxLength=200 |

### `GET /api/challenges/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getChallengeById` |
| **Summary** | Get challenge by ID with participants |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/challenges/:id/join`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `joinChallenge` |
| **Summary** | Join challenge |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

---

## Badges

**Controller:** `modules/badges/badges.controller.ts`

### `GET /api/badges/types`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getBadgeTypes` |

_No path, query, or body parameters._

### `GET /api/badges/my-status`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMyBadgeStatus` |

_No path, query, or body parameters._

### `GET /api/badges/my-applications`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `listMyApplications` |

_No path, query, or body parameters._

### `DELETE /api/badges/my-applications/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `withdrawApplication` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `POST /api/badges/apply`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `applyForBadge` |

**Body** (`ApplyBadgeDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `badgeType` | enum:BadgeType | required | — |
| `fullLegalName` | string | required | maxLength=200 |
| `businessPhone` | string | required | maxLength=30 |
| `businessEmail` | email string | optional | — |
| `ownershipType` | enum:OwnershipType | optional | — |
| `propertyAddress` | string | optional | maxLength=500 |
| `restaurantName` | string | optional | maxLength=200 |
| `cuisineType` | string | optional | maxLength=100 |
| `restaurantAddress` | string | optional | maxLength=500 |
| `agencyName` | string | optional | maxLength=200 |
| `agencyLicense` | string | optional | maxLength=100 |
| `propertiesManaged` | number (int) | optional | min=0 |
| `companyWebsite` | string | optional | maxLength=500 |
| `neighborhoodArea` | string | optional | maxLength=300 |
| `reviewerBio` | string | optional | maxLength=1000 |

### `GET /api/badges/applications/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getApplicationById` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `GET /api/badges/applications/:applicationId/documents/:documentId/url`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getDocumentUrl` |

**Path parameters**

| Name | Type |
|------|------|
| `applicationId` | string |
| `documentId` | string |

---

## Messaging / Conversations

**Controller:** `modules/messaging/messaging.controller.ts`

### `GET /api/conversations`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getConversations` |

**Query parameters** (`ConversationsQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `type` | 'all' | 'listings' | 'events' | optional | default='all' |
| `search` | string | optional | maxLength=200 |

### `GET /api/conversations/unread-count`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getUnreadCount` |

_No path, query, or body parameters._

### `POST /api/conversations`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `createConversation` |

**Body** (`CreateConversationDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `participantId` | string | required | Other user ID for DIRECT conversation |
| `contextType` | enum:ConversationContextType | optional | — |
| `contextId` | string | optional | Listing or event ID that prompted the conversation |
| `title` | string | optional | maxLength=200; Ignored for DIRECT; optional display hint from client |

### `POST /api/conversations/audio/upload`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `uploadAudio` |

**Body** (`multipart/form-data`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| file field(s) | `binary` / `binary[]` | required | Uploaded via `FileInterceptor` / `FilesInterceptor` |

### `DELETE /api/conversations/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `hideConversation` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `GET /api/conversations/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getConversationById` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `PATCH /api/conversations/members/:id/status`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updateMemberStatus` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`UpdateMemberStatusDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `status` | 'ACCEPTED' | 'BLOCKED' | required | — |

### `GET /api/conversations/:id/messages`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getMessages` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `cursor` | string | optional | — |
| `limit` | string | optional | — |

### `POST /api/conversations/:id/messages`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `sendMessage` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`SendMessageDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `content` | string | required | maxLength=5000 |
| `type` | enum:MessageType | optional | — |
| `audioUrl` | string | optional | — |
| `durationSeconds` | number | optional | — |

**Body** (`multipart/form-data`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `content` | string | required | maxLength=5000 |
| `type` | enum:MessageType | optional | — |
| `audioUrl` | string | optional | — |
| `durationSeconds` | number | optional | — |
| file field(s) | `binary` / `binary[]` | required | Uploaded via `FileInterceptor` / `FilesInterceptor` |

### `PATCH /api/conversations/:id/read`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `markAsRead` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

---

## Notifications

**Controller:** `modules/notifications/notifications.controller.ts`

### `GET /api/notifications`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getNotifications` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/notifications/unread-count`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getUnreadCount` |

_No path, query, or body parameters._

### `GET /api/notifications/preferences`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getPreferences` |

_No path, query, or body parameters._

### `PATCH /api/notifications/preferences`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updatePreferences` |

**Body** (`UpdateNotificationPreferencesDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `pushEnabled` | boolean | optional | — |
| `emailEnabled` | boolean | optional | — |
| `eventsNearby` | boolean | optional | — |
| `comments` | boolean | optional | — |
| `likes` | boolean | optional | — |
| `messages` | boolean | optional | — |

### `POST /api/notifications/push-token`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `registerPushToken` |

**Body** (`NotificationRegisterPushTokenDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `token` | string | required | maxLength=512 |
| `platform` | 'ios' | 'android' | 'web' | required | — |

### `DELETE /api/notifications/push-token`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `removePushToken` |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `token` | string | optional | — |

### `PATCH /api/notifications/read-all`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `markAllAsRead` |

_No path, query, or body parameters._

### `PATCH /api/notifications/:id/read`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `markAsRead` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `DELETE /api/notifications/:id`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteOne` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `DELETE /api/notifications`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteAll` |

_No path, query, or body parameters._

---

## Saves

**Controller:** `modules/saves/saves.controller.ts`

### `GET /api/saves`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getSaves` |
| **Summary** | Unified saved items: counts only when |

**Query parameters** (`SavesQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `type` | SaveTypeParam | optional | When set, returns paginated saved items for that type only. |
| `page` | number (int) | optional | min=1 |
| `limit` | number (int) | optional | min=1, max=50 |

---

## Settings

**Controller:** `modules/settings/settings.controller.ts`

### `GET /api/settings/account`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getAccount` |

_No path, query, or body parameters._

### `PATCH /api/settings/account`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updateAccount` |

**Body** (`UpdateAccountDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `currentPassword` | string | required | Current password (required for any change) |
| `newEmail` | email string | optional | — |
| `newPassword` | string | optional | maxLength=100 |
| `newUsername` | string | optional | maxLength=20 |

### `GET /api/settings/privacy`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getPrivacy` |

_No path, query, or body parameters._

### `PATCH /api/settings/privacy`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updatePrivacy` |

**Body** (`UpdatePrivacyDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `publicProfile` | boolean | optional | — |
| `showLocation` | boolean | optional | — |
| `activityStatus` | boolean | optional | — |

### `GET /api/settings/blocked-users`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `getBlockedUsers` |

_No path, query, or body parameters._

### `POST /api/settings/blocked-users`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `blockUser` |

**Body** (`BlockUserDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `userId` | string | required | — |

### `DELETE /api/settings/blocked-users/:userId`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `unblockUser` |

**Path parameters**

| Name | Type |
|------|------|
| `userId` | string |

### `PATCH /api/settings/city`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updateCity` |

**Body** (`UpdateCityDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `country` | string | required | maxLength=100 |
| `countryCode` | string | required | — |
| `dialCode` | string | required | maxLength=6 |
| `state` | string | required | maxLength=100 |
| `city` | string | required | maxLength=100 |

### `PATCH /api/settings/culture`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `updateCulture` |

**Body** (`UpdateCultureDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `vibeIds` | string[] | optional | — |
| `interestIds` | string[] | optional | — |
| `communityIds` | string[] | optional | — |

### `POST /api/settings/delete-account`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `requestDeletion` |

_No path, query, or body parameters._

### `POST /api/settings/delete-account/immediate`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `deleteAccountImmediately` |
| **Summary** | Immediately and permanently delete account |

_No path, query, or body parameters._

### `POST /api/settings/cancel-deletion`

| | |
|---|---|
| **Auth** | Auth |
| **Handler** | `cancelDeletion` |

_No path, query, or body parameters._

---

## Admin

**Controller:** `modules/admin/admin.controller.ts`

### `GET /api/admin/users`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getUsers` |

**Query parameters** (`AdminUsersQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |
| `search` | string | optional | — |
| `role` | enum:Role | optional | — |
| `isActive` | boolean | optional | — |

### `GET /api/admin/analytics`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getAnalytics` |

_No path, query, or body parameters._

### `GET /api/admin/reports`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getReports` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `GET /api/admin/feed`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getFeedPosts` |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | string | optional | — |
| `pageSize` | string | optional | — |
| `search` | string | optional | — |
| `category` | string | optional | — |
| `published` | string | optional | — |

### `GET /api/admin/feed/trending`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getTrendingPosts` |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `limit` | string | optional | — |

### `PATCH /api/admin/feed/:id/moderate`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `moderateFeedPost` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`ModerateActionDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `action` | string | required | — |

### `GET /api/admin/polls`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getPolls` |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | string | optional | — |
| `pageSize` | string | optional | — |

### `POST /api/admin/polls`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `createPoll` |

**Body** (`CreateAdminPollDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `question` | string | required | maxLength=300 |
| `options` | string[] | required | — |

### `PATCH /api/admin/polls/:id/toggle`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `togglePoll` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `DELETE /api/admin/polls/:id`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `deletePoll` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `GET /api/admin/community/questions`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getCommunityQuestions` |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | string | optional | — |
| `pageSize` | string | optional | — |
| `search` | string | optional | — |
| `category` | string | optional | — |

### `GET /api/admin/community/news`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getCommunityNews` |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | string | optional | — |
| `pageSize` | string | optional | — |
| `search` | string | optional | — |
| `category` | string | optional | — |

### `DELETE /api/admin/community/questions/:id`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `moderateCommunityQuestion` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `GET /api/admin/roommates`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getRoommates` |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | string | optional | — |
| `pageSize` | string | optional | — |
| `search` | string | optional | — |

### `PATCH /api/admin/roommates/:id/moderate`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `moderateRoommate` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`ModerateActionDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `action` | string | required | — |

### `GET /api/admin/restaurants`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getRestaurants` |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | string | optional | — |
| `pageSize` | string | optional | — |
| `search` | string | optional | — |
| `isVerified` | string | optional | — |

### `PATCH /api/admin/restaurants/:id/moderate`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `moderateRestaurant` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`ModerateActionDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `action` | string | required | — |

### `GET /api/admin/listings`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getListings` |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | string | optional | — |
| `pageSize` | string | optional | — |
| `search` | string | optional | — |
| `status` | string | optional | — |
| `propertyType` | string | optional | — |

### `PATCH /api/admin/listings/:id/moderate`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `moderateListing` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`ModerateActionDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `action` | string | required | — |

### `GET /api/admin/areas`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getAreas` |

_No path, query, or body parameters._

### `GET /api/admin/notifications/broadcasts`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getBroadcastHistory` |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | string | optional | — |
| `pageSize` | string | optional | — |

### `POST /api/admin/notifications/broadcast`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `sendBroadcast` |

**Body** (`SendBroadcastDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `title` | string | required | maxLength=100 |
| `body` | string | required | maxLength=300 |
| `audienceType` | enum:BroadcastAudienceType | required | — |
| `audienceCity` | string | optional | — |
| `audienceUserIds` | string[] | optional | — |

### `GET /api/admin/support`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getSupportTickets` |

**Query parameters**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | string | optional | — |
| `pageSize` | string | optional | — |
| `status` | string | optional | — |

### `PATCH /api/admin/support/:id/reply`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `replyToTicket` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`ReplyToTicketDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `reply` | string | required | maxLength=2000 |
| `close` | boolean | optional | — |

### `GET /api/admin/sessions`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getActiveSessions` |
| **Summary** | List active authenticated sessions |

**Query parameters** (`AdminSessionsQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number | optional | default=1 |
| `pageSize` | number | optional | default=20 |
| `userId` | string | optional | — |

### `DELETE /api/admin/sessions/session/:sessionId`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `terminateSession` |
| **Summary** | Terminate one active session |

**Path parameters**

| Name | Type |
|------|------|
| `sessionId` | string |

### `DELETE /api/admin/sessions/user/:userId`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `terminateUserSessions` |
| **Summary** | Terminate all active sessions for one user |

**Path parameters**

| Name | Type |
|------|------|
| `userId` | string |

### `PATCH /api/admin/reports/:id/dismiss`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `dismissReport` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `DELETE /api/admin/reports/:id/listing`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `resolveReportAndDeleteListing` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `GET /api/admin/settings`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getPlatformSettings` |

_No path, query, or body parameters._

### `PATCH /api/admin/settings`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `updatePlatformSettings` |

**Body** (`UpdatePlatformSettingsDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `maintenanceMode` | boolean | optional | — |
| `registrationEnabled` | boolean | optional | — |
| `maxFileUploadMB` | number (int) | optional | min=1, max=50 |

### `GET /api/admin/content`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getContent` |

**Query parameters** (`AdminContentQueryDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |
| `contentType` | 'feed_posts' | 'housing' | 'restaurants' | optional | — |
| `search` | string | optional | — |

### `GET /api/admin/badges/applications`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getBadgeApplications` |

**Query parameters** (`PaginationDto`)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `page` | number (int) | optional | min=1, default=1 |
| `limit` | number (int) | optional | min=1, max=50, default=20 |

### `PATCH /api/admin/badges/applications/:id/approve`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `approveBadgeApplication` |
| **Summary** | Approve badge application |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`ApproveBadgeApplicationDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `adminNotes` | string | optional | maxLength=1000 |

### `PATCH /api/admin/badges/applications/:id/reject`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `rejectBadgeApplication` |
| **Summary** | Reject badge application |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`RejectBadgeApplicationDto` — JSON)

_No fields declared (empty / passthrough DTO)._

### `PATCH /api/admin/badges/applications/:id`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `reviewBadgeApplication` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`ReviewBadgeApplicationDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `status` | 'APPROVED' | 'REJECTED' | required | — |
| `adminNotes` | string | optional | maxLength=1000 |

### `GET /api/admin/users/:id`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `getUserById` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `PATCH /api/admin/users/:id`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `updateUser` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`UpdateUserAdminDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `role` | enum:Role | optional | — |
| `isActive` | boolean | optional | — |

### `POST /api/admin/users/:id/warn`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `warnUser` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`WarnUserDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `message` | string | required | maxLength=2000 |

### `POST /api/admin/users/:id/grant-badge`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `grantUserBadge` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`GrantUserBadgeDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `badgeType` | enum:BadgeType | required | — |

### `DELETE /api/admin/users/:id/revoke-badge/:type`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `revokeUserBadge` |
| **Summary** | Revoke a badge from a user |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `DELETE /api/admin/users/:id`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `deleteUser` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

### `PATCH /api/admin/content/:id`

| | |
|---|---|
| **Auth** | Admin |
| **Handler** | `moderateContent` |

**Path parameters**

| Name | Type |
|------|------|
| `id` | string |

**Body** (`ModerateContentDto` — JSON)

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `contentType` | string | required | — |
| `action` | string | required | — |
| `reason` | string | optional | maxLength=500 |

