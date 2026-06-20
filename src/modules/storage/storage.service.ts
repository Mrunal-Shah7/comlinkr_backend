import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type { UploadApiResponse } from 'cloudinary';

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

const CLOUDINARY_URL_PATTERN =
  /^https:\/\/res\.cloudinary\.com\/[^/]+\/([^/]+)\/(?:upload|private)\/(?:v\d+\/)?(.+)\.[^/.?]+$/;

function detectMimeFromMagic(buffer: Buffer): string | null {
  for (const { mime, check } of MAGIC) {
    if (check(buffer)) return mime;
  }
  return null;
}

@Injectable()
export class StorageService {
  private readonly cloudName: string;

  constructor(private readonly configService: ConfigService) {
    this.cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME', '');
    cloudinary.config({
      cloud_name: this.cloudName,
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY', ''),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET', ''),
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

  getPublicBaseUrl(): string {
    if (!this.cloudName) return '';
    return `https://res.cloudinary.com/${this.cloudName}`;
  }

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

  extractObjectKey(stored: string): string | null {
    if (!stored) return null;
    const s = stored.trim();
    if (s.startsWith('/api/') || s.startsWith('api/')) return null;

    const compositeMatch = /^[^:]+:[^:]+:.+$/.test(s);
    if (compositeMatch) {
      const parts = s.split(':');
      if (parts.length === 3) return parts[2] ?? null;
    }

    const urlMatch = s.match(CLOUDINARY_URL_PATTERN);
    if (urlMatch) return urlMatch[2] ?? null;

    if (!s.startsWith('http://') && !s.startsWith('https://')) {
      const key = s.replace(/^\/+/, '');
      if (key.includes('/') && !key.includes('..')) return key;
    }

    return null;
  }

  async getReadUrlForClient(
    stored: string | null | undefined,
    _expiresInSeconds = 7200,
  ): Promise<string> {
    return this.resolvePublicUrl(stored);
  }

  private resourceTypeFromMime(mimeType: string): 'image' | 'video' {
    if (mimeType.startsWith('video/')) return 'video';
    return 'image';
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

  private uploadBuffer(
    buffer: Buffer,
    mimeType: string,
    publicId: string,
    extension: string,
    deliveryType: 'upload' | 'private',
  ): Promise<UploadApiResponse> {
    const resourceType = this.resourceTypeFromMime(mimeType);
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: resourceType,
          type: deliveryType,
          format: extension,
          overwrite: true,
        },
        (error, result) => {
          if (error) reject(error);
          else if (!result) reject(new Error('Cloudinary upload returned no result'));
          else resolve(result);
        },
      );
      stream.end(buffer);
    });
  }

  async uploadPublicFile(
    buffer: Buffer,
    mimeType: string,
    folder: string,
    fileUuid: string,
    extension: string,
  ): Promise<string> {
    const authoritativeMimeType = this.validateMime(buffer, mimeType);
    const publicId = `${folder}/${fileUuid}`;
    const result = await this.uploadBuffer(
      buffer,
      authoritativeMimeType,
      publicId,
      extension,
      'upload',
    );
    return result.secure_url;
  }

  async uploadPrivateFile(
    buffer: Buffer,
    mimeType: string,
    folder: string,
    fileUuid: string,
    extension: string,
  ): Promise<string> {
    const authoritativeMimeType = this.validateMime(buffer, mimeType);
    const publicId = `${folder}/${fileUuid}`;
    const resourceType = this.resourceTypeFromMime(authoritativeMimeType);
    await this.uploadBuffer(buffer, authoritativeMimeType, publicId, extension, 'private');
    return `${resourceType}:${extension}:${publicId}`;
  }

  async getSignedUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    const parts = objectKey.split(':');
    if (parts.length !== 3) {
      throw new BadRequestException({
        code: 'FILE_INVALID_KEY',
        message: 'Invalid document key format.',
      });
    }
    const [resourceType, extension, publicId] = parts;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return cloudinary.utils.private_download_url(publicId, extension, {
      resource_type: resourceType,
      type: 'private',
      expires_at: expiresAt,
    });
  }

  private parseCloudinaryUrl(url: string): { resourceType: string; publicId: string; type: 'upload' | 'private' } | null {
    const match = url.match(CLOUDINARY_URL_PATTERN);
    if (!match) return null;
    const deliverySegment = url.includes('/private/') ? 'private' : 'upload';
    return {
      resourceType: match[1]!,
      publicId: match[2]!,
      type: deliverySegment === 'private' ? 'private' : 'upload',
    };
  }

  async deleteFile(keyOrUrl: string): Promise<void> {
    let resourceType: string;
    let publicId: string;
    let deliveryType: 'upload' | 'private';

    if (keyOrUrl.startsWith('https://res.cloudinary.com')) {
      const parsed = this.parseCloudinaryUrl(keyOrUrl);
      if (!parsed) return;
      resourceType = parsed.resourceType;
      publicId = parsed.publicId;
      deliveryType = parsed.type;
    } else if (/^[^:]+:[^:]+:.+$/.test(keyOrUrl)) {
      const parts = keyOrUrl.split(':');
      if (parts.length !== 3) return;
      resourceType = parts[0]!;
      publicId = parts[2]!;
      deliveryType = 'private';
    } else {
      return;
    }

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: deliveryType,
      invalidate: true,
    });
    if (result.result === 'not found') return;
  }
}
