import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationDto {
  // RN / fetch sometimes injects a cache-buster query param named `_`.
  // Because the app uses `forbidNonWhitelisted: true`, we must explicitly allow it
  // to avoid 400 errors on endpoints that validate query params.
  @IsOptional()
  @Type(() => String)
  @IsString()
  _: string | undefined;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export function createPaginationMeta(
  page: number,
  limit: number,
  total: number,
): { page: number; limit: number; total: number; totalPages: number } {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
