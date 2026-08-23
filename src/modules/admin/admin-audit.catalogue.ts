/**
 * SPRINT-52: catalogue-driven target extraction for mutating admin routes.
 * Keys are route patterns as registered on AdminController (controller path + method path).
 */
export type AdminAuditRouteMeta = {
  /** Path param name that identifies the target record, or null when the route affects a fixed area */
  targetParam: string | null;
  /** Record kind for the path param, or a fixed area label when targetParam is null */
  targetType: string;
};

export const ADMIN_MUTATING_ROUTE_CATALOGUE: Record<
  string,
  AdminAuditRouteMeta
> = {
  // SPRINT-52: reports
  'POST /admin/reports/:id/action': {
    targetParam: 'id',
    targetType: 'report',
  },
  'PATCH /admin/reports/:id/dismiss': {
    targetParam: 'id',
    targetType: 'report',
  },
  'DELETE /admin/reports/:id/listing': {
    targetParam: 'id',
    targetType: 'report',
  },
  // SPRINT-53: admin chat
  'DELETE /admin/chat/messages/:id': {
    targetParam: 'id',
    targetType: 'message',
  },
  // SPRINT-52: feed
  'PATCH /admin/feed/:id/moderate': {
    targetParam: 'id',
    targetType: 'feed_post',
  },
  // SPRINT-52: polls
  'POST /admin/polls': { targetParam: null, targetType: 'admin_polls' },
  'PATCH /admin/polls/:id/toggle': {
    targetParam: 'id',
    targetType: 'admin_poll',
  },
  'DELETE /admin/polls/:id': { targetParam: 'id', targetType: 'admin_poll' },
  // SPRINT-52: community
  'DELETE /admin/community/questions/:id': {
    targetParam: 'id',
    targetType: 'community_question',
  },
  // SPRINT-52: roommates / restaurants / listings
  'PATCH /admin/roommates/:id/moderate': {
    targetParam: 'id',
    targetType: 'user',
  },
  'PATCH /admin/restaurants/:id/moderate': {
    targetParam: 'id',
    targetType: 'restaurant',
  },
  'PATCH /admin/listings/:id/moderate': {
    targetParam: 'id',
    targetType: 'housing_listing',
  },
  // SPRINT-54: stories moderation
  'DELETE /admin/stories/:id': {
    targetParam: 'id',
    targetType: 'story',
  },
  // SPRINT-52: notifications / support / sessions
  'POST /admin/notifications/broadcast': {
    targetParam: null,
    targetType: 'broadcast',
  },
  'PATCH /admin/support/:id/reply': {
    targetParam: 'id',
    targetType: 'support_ticket',
  },
  'DELETE /admin/sessions/session/:sessionId': {
    targetParam: 'sessionId',
    targetType: 'session',
  },
  'DELETE /admin/sessions/user/:userId': {
    targetParam: 'userId',
    targetType: 'user',
  },
  // SPRINT-52: settings / badges / users / content
  'PATCH /admin/settings': {
    targetParam: null,
    targetType: 'platform_settings',
  },
  'PATCH /admin/badges/applications/:id/approve': {
    targetParam: 'id',
    targetType: 'badge_application',
  },
  'PATCH /admin/badges/applications/:id/reject': {
    targetParam: 'id',
    targetType: 'badge_application',
  },
  'PATCH /admin/badges/applications/:id': {
    targetParam: 'id',
    targetType: 'badge_application',
  },
  'PATCH /admin/users/:id': { targetParam: 'id', targetType: 'user' },
  'POST /admin/users/:id/warn': { targetParam: 'id', targetType: 'user' },
  // SPRINT-55: privacy export / erasure / compliance decisions
  'POST /admin/users/:id/data-export': {
    targetParam: 'id',
    targetType: 'user',
  },
  'POST /admin/users/:id/erasure-request': {
    targetParam: 'id',
    targetType: 'user',
  },
  'PATCH /admin/privacy-requests/:id/approve': {
    targetParam: 'id',
    targetType: 'privacy_request',
  },
  'PATCH /admin/privacy-requests/:id/reject': {
    targetParam: 'id',
    targetType: 'privacy_request',
  },
  'POST /admin/users/:id/grant-badge': {
    targetParam: 'id',
    targetType: 'user',
  },
  'DELETE /admin/users/:id/revoke-badge/:type': {
    targetParam: 'id',
    targetType: 'user',
  },
  'DELETE /admin/users/:id': { targetParam: 'id', targetType: 'user' },
  'PATCH /admin/content/:id': { targetParam: 'id', targetType: 'content' },
};

/** SPRINT-52: justification field priority from Phase 1.2 catalogue */
export function extractAdminJustification(
  body: Record<string, unknown> | undefined | null,
): string | null {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.reason === 'string' && body.reason.trim()) {
    return body.reason.trim();
  }
  if (typeof body.adminNotes === 'string' && body.adminNotes.trim()) {
    return body.adminNotes.trim();
  }
  // SPRINT-52: warnUser uses `message` as the human-supplied justification
  if (typeof body.message === 'string' && body.message.trim()) {
    return body.message.trim();
  }
  return null;
}
