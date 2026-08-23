import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ADMIN_MUTATING_ROUTE_CATALOGUE,
  extractAdminJustification,
} from './admin-audit.catalogue';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']); // SPRINT-52

// SPRINT-52: single interceptor for successful mutating admin requests
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminAuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string>;
      user?: { id?: string };
      url?: string;
    }>();

    const method = (request.method || '').toUpperCase();
    if (!MUTATING_METHODS.has(method)) {
      // SPRINT-52: reads are never audited
      return next.handle();
    }

    const controllerPath = String(
      Reflect.getMetadata(PATH_METADATA, context.getClass()) ?? '',
    );
    const handlerPath = String(
      Reflect.getMetadata(PATH_METADATA, context.getHandler()) ?? '',
    );
    const routePattern = normalizeAdminRoutePattern(
      controllerPath,
      handlerPath,
    );

    // SPRINT-52: only the admin controller prefix (defence if somehow attached elsewhere)
    if (!routePattern.startsWith('/admin')) {
      return next.handle();
    }

    const actionKey = `${method} ${routePattern}`;

    return next.handle().pipe(
      tap({
        next: () => {
          // SPRINT-52: fire-and-forget write after successful handler completion
          void this.persistEntry(request, method, routePattern, actionKey);
        },
      }),
    );
  }

  private async persistEntry(
    request: {
      body?: Record<string, unknown>;
      params?: Record<string, string>;
      user?: { id?: string };
    },
    method: string,
    routePattern: string,
    actionKey: string,
  ): Promise<void> {
    try {
      const adminId = request.user?.id;
      if (!adminId) {
        // SPRINT-52: without an authenticated admin identity, skip rather than invent
        return;
      }

      const meta = ADMIN_MUTATING_ROUTE_CATALOGUE[actionKey];
      let targetType: string | null = null;
      let targetId: string | null = null;

      if (meta) {
        targetType = meta.targetType;
        if (meta.targetParam) {
          targetId = request.params?.[meta.targetParam] ?? null;
        }
      } else {
        // SPRINT-52: unknown mutating admin route — still log with best-effort params
        this.logger.warn(
          `Uncatalogued admin mutation ${actionKey}; logging with best-effort target.`,
        );
        const paramEntries = Object.entries(request.params ?? {});
        if (paramEntries.length > 0) {
          const [key, value] = paramEntries[0];
          targetType = key;
          targetId = value;
        } else {
          targetType = 'admin';
        }
      }

      const reason = extractAdminJustification(request.body);

      await this.prisma.adminAuditLog.create({
        data: {
          adminId,
          httpMethod: method,
          routePattern,
          targetType,
          targetId,
          reason,
        },
      });
    } catch (err) {
      // SPRINT-52: never fail the original admin response because audit write failed
      this.logger.warn(`Failed to write admin audit log: ${err}`);
    }
  }
}

/** SPRINT-52: build `/admin/...` pattern from Nest path metadata */
function normalizeAdminRoutePattern(
  controllerPath: string,
  handlerPath: string,
): string {
  const parts = [controllerPath, handlerPath]
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  return `/${parts.join('/')}`.replace(/\/+/g, '/');
}
