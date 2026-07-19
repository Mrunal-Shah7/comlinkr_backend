import { Type } from 'class-transformer'; // SPRINT-35: transform numeric session pagination query values
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'; // SPRINT-35: validate session pagination and optional user filter

export class AdminSessionsQueryDto { // SPRINT-35: define the admin session-list query contract
  @IsOptional() // SPRINT-35: default to the first page when omitted
  @Type(() => Number) // SPRINT-35: convert the HTTP query string to a number
  @IsInt() // SPRINT-35: reject fractional or malformed pages
  @Min(1) // SPRINT-35: require one-based pagination
  page?: number = 1; // SPRINT-35: use the majority admin-list page convention

  @IsOptional() // SPRINT-35: default the page size when omitted
  @Type(() => Number) // SPRINT-35: convert the HTTP query string to a number
  @IsInt() // SPRINT-35: reject fractional or malformed page sizes
  @Min(1) // SPRINT-35: require at least one session per page
  @Max(100) // SPRINT-35: bound in-memory response size
  pageSize?: number = 20; // SPRINT-35: use the majority admin-list pageSize convention

  @IsOptional() // SPRINT-35: allow an unfiltered all-user session list
  @IsUUID() // SPRINT-35: constrain the optional target user identifier
  userId?: string; // SPRINT-35: filter authenticated sessions to one user before pagination
} // SPRINT-35: complete session-list query DTO
