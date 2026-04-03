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
          const { data: items, meta } = data as {
            data: unknown;
            meta: { page: number; limit: number; total: number; totalPages: number };
          };
          return {
            success: true,
            data: items,
            meta,
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
