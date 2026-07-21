import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Allow unauthenticated (guest) access while still hydrating `request.user`
 * when a valid session cookie is present. Used for browse/detail GETs.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
