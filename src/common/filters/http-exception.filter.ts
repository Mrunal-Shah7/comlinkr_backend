import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';

const ERROR_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'RESOURCE_NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: Array<{ field: string; message: string }> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        if (typeof body.code === 'string') code = body.code;
        if (typeof body.message === 'string') message = body.message;
        else if (Array.isArray(body.message)) {
          message = 'Validation failed';
          details = (body.message as string[]).map((msg) => {
            const fieldMatch = msg.match(/^(\w+)\s/);
            return {
              field: fieldMatch ? fieldMatch[1] : 'field',
              message: msg,
            };
          });
          code = 'VALIDATION_ERROR';
        }
      } else if (typeof res === 'string') {
        message = res;
      }
      if (code === 'INTERNAL_ERROR' && status in ERROR_CODES) {
        code = ERROR_CODES[status];
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'DUPLICATE_ENTRY';
        message = 'A record with this value already exists';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'RESOURCE_NOT_FOUND';
        message = 'Record not found';
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.stack);
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        ...(details && details.length > 0 && { details }),
      },
    });
  }
}
