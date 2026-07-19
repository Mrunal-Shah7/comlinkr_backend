import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        // Already in API envelope shape — avoid double wrap
        if (
          data &&
          typeof data === 'object' &&
          'success' in data &&
          (data as { success: boolean }).success === true &&
          'data' in data
        ) {
          return data;
        }
        // Cursor-paginated response: { data, nextCursor } — wrap with success and keep nextCursor
        if (
          data &&
          typeof data === 'object' &&
          'data' in data &&
          'nextCursor' in data
        ) {
          const { data: items, nextCursor } = data as {
            data: unknown;
            nextCursor: string | null;
          };
          return { success: true, data: items, nextCursor };
        }
        if (
          data &&
          typeof data === 'object' &&
          'data' in data &&
          'meta' in data
        ) {
          // SPRINT-43: Lift data/meta into the standard envelope while preserving every sibling key.
          // SPRINT-43: Previously only data and meta were copied, which dropped check-in totals and any future siblings.
          const payload = data as {
            data: unknown;
            meta: {
              page: number;
              limit: number;
              total: number;
              totalPages: number;
            };
          } & Record<string, unknown>; // SPRINT-43: allow reading sibling keys beyond data/meta
          const { data: items, meta, ...siblings } = payload; // SPRINT-43: separate standard keys from siblings
          return {
            success: true,
            data: items,
            meta,
            ...siblings, // SPRINT-43: forward siblings (e.g. totalRegistered, truncated) without renaming
          };
        }
        return {
          success: true,
          data,
        };
      }),
    );
  }
}
