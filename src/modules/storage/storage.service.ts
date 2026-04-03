import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

const MAGIC: Array<{ mime: string; check: (buf: Buffer) => boolean }> = [
  { mime: 'image/jpeg', check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', check: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/gif', check: (b) => b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  { mime: 'application/pdf', check: (b) => b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { mime: 'image/webp', check: (b) => b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  { mime: 'video/mp4', check: (b) => b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
  { mime: 'video/webm', check: (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: 'video/quicktime', check: (b) => b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x71 },
];

function detectMimeFromMagic(buffer: Buffer): string | null {
  for (const { mime, check } of MAGIC) {
    if (check(buffer)) return mime;
  }
  return null;
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucketName: string;
  private readonly bucketUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME', '');
    this.bucketUrl = this.configService.get<string>('AWS_S3_BUCKET_URL', '').replace(/\/$/, '');
    this.client = new S3Client({
      region: this.configService.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  static extensionFromMime(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'application/pdf': 'pdf',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
    };
    return map[mimeType] ?? 'bin';
  }

  /**
   * Public base URL for objects in the bucket. Uses AWS_S3_BUCKET_URL when set;
   * otherwise virtual-hosted–style https://{bucket}.s3.{region}.amazonaws.com
   * so uploads never store a bare `/folder/key` path that clients mis-resolve to the API host.
   */
  getPublicBaseUrl(): string {
    if (this.bucketUrl) return this.bucketUrl;
    if (!this.bucketName) return '';
    const region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    return `https://${this.bucketName}.s3.${region}.amazonaws.com`;
  }

  /**
   * Normalize a stored DB value (full URL, S3 key, or legacy `/events/...` from misconfigured uploads)
   * to an absolute https URL for mobile/web clients.
   */
  resolvePublicUrl(stored: string | null | undefined): string {
    if (stored == null || stored === '') return '';
    const s = stored.trim();
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    if (s.startsWith('/api/') || s.startsWith('api/')) {
      return s.startsWith('/') ? s : `/${s}`;
    }
    const base = this.getPublicBaseUrl();
    const key = s.replace(/^\/+/, '');
    if (!base) return s.startsWith('/') ? s : `/${key}`;
    return `${base}/${key}`;
  }

  /**
   * Extract S3 object key from a stored URL or `folder/file.ext` key string.
   * Returns null for non-S3 URLs (e.g. external avatars) or unknown shapes.
   */
  extractObjectKey(stored: string): string | null {
    if (!stored || !this.bucketName) return null;
    const s = stored.trim();
    if (s.startsWith('/api/') || s.startsWith('api/')) return null;

    const stripQuery = (url: string) => url.split('?')[0] ?? url;

    if (this.bucketUrl && (s.startsWith('http://') || s.startsWith('https://'))) {
      const base = this.bucketUrl;
      if (s.startsWith(`${base}/`)) {
        return stripQuery(s.slice(base.length + 1)) || null;
      }
    }
    const computedBase = this.getPublicBaseUrl();
    if (
      computedBase &&
      (s.startsWith('http://') || s.startsWith('https://')) &&
      s.startsWith(`${computedBase}/`)
    ) {
      return stripQuery(s.slice(computedBase.length + 1)) || null;
    }

    if (!s.startsWith('http://') && !s.startsWith('https://')) {
      const key = s.replace(/^\/+/, '');
      if (key.includes('/') && !key.includes('..')) return key;
      return null;
    }

    try {
      const u = new URL(s);
      const host = u.hostname;
      const path = u.pathname.replace(/^\//, '');
      if (
        host.startsWith(`${this.bucketName}.s3.`) ||
        host === `${this.bucketName}.s3.amazonaws.com`
      ) {
        return stripQuery(path) || null;
      }
      if (host.startsWith('s3.') && path.startsWith(`${this.bucketName}/`)) {
        return stripQuery(path.slice(this.bucketName.length + 1)) || null;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * URL safe to pass to browsers / React Native for S3 objects that may be private.
   * When AWS_S3_PRESIGN_GET_URLS is true (default), returns a presigned GET URL.
   * Set AWS_S3_PRESIGN_GET_URLS=false only if the bucket allows public GetObject.
   */
  async getReadUrlForClient(
    stored: string | null | undefined,
    expiresInSeconds = 7200,
  ): Promise<string> {
    if (stored == null || stored === '') return '';
    const s = stored.trim();
    const presignEnabled =
      this.configService.get<string>('AWS_S3_PRESIGN_GET_URLS', 'true') !== 'false';
    if (!presignEnabled || !this.bucketName) {
      return this.resolvePublicUrl(stored);
    }
    const key = this.extractObjectKey(s);
    if (key) {
      return this.getSignedUrl(key, expiresInSeconds);
    }
    if (s.startsWith('http://') || s.startsWith('https://')) {
      return s;
    }
    return this.resolvePublicUrl(stored);
  }

  private validateMime(buffer: Buffer, declaredMimeType: string): string {
    const detected = detectMimeFromMagic(buffer);
    if (!detected || !ALLOWED_MIME_TYPES.includes(detected)) {
      throw new BadRequestException({
        code: 'FILE_INVALID_TYPE',
        message: 'File type does not match its content. Upload rejected.',
      });
    }
    if (!ALLOWED_MIME_TYPES.includes(declaredMimeType)) {
      throw new BadRequestException({
        code: 'FILE_INVALID_TYPE',
        message: 'File type does not match its content. Upload rejected.',
      });
    }
    return detected;
  }

  async uploadPublicFile(
    buffer: Buffer,
    mimeType: string,
    folder: string,
    fileUuid: string,
    extension: string,
  ): Promise<string> {
    const authoritativeMimeType = this.validateMime(buffer, mimeType);
    const key = `${folder}/${fileUuid}.${extension}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: authoritativeMimeType,
      }),
    );
    const base = this.getPublicBaseUrl();
    return base ? `${base}/${key}` : `/${key}`;
  }

  async uploadPrivateFile(
    buffer: Buffer,
    mimeType: string,
    folder: string,
    fileUuid: string,
    extension: string,
  ): Promise<string> {
    const authoritativeMimeType = this.validateMime(buffer, mimeType);
    const key = `${folder}/${fileUuid}.${extension}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: authoritativeMimeType,
      }),
    );
    return key;
  }

  async getSignedUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
    });
    return awsGetSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
  }

  async deleteFile(keyOrUrl: string): Promise<void> {
    let key = keyOrUrl;
    if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
      const base = this.getPublicBaseUrl();
      if (base && keyOrUrl.startsWith(`${base}/`)) {
        key = keyOrUrl.slice(base.length + 1);
      } else if (this.bucketUrl && keyOrUrl.startsWith(`${this.bucketUrl}/`)) {
        key = keyOrUrl.slice(this.bucketUrl.length + 1);
      } else {
        try {
          const u = new URL(keyOrUrl);
          key = u.pathname.replace(/^\//, '');
        } catch {
          key = keyOrUrl;
        }
      }
    } else {
      key = keyOrUrl.replace(/^\//, '');
    }
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
  }
}
