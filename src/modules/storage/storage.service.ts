import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type { UploadApiResponse } from 'cloudinary';
import { randomUUID } from 'crypto'; // SPRINT-36: generate unguessable public audio object keys

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

export const AUDIO_MIME_TYPES = [
  // SPRINT-36: accept mobile voice-note containers covered by the documented client contract
  'audio/mp4', // SPRINT-36: Expo high-quality iOS and Android MPEG-4/AAC recording
  'audio/x-m4a', // SPRINT-36: common iOS MIME alias for the same M4A container
  'audio/mpeg', // SPRINT-36: standard MP3/MPEG audio
  'audio/aac', // SPRINT-36: raw AAC recorder output
  'audio/3gpp', // SPRINT-36: Android platform recorder 3GP container
  'audio/webm', // SPRINT-36: Android/web recorder WebM container
  'audio/ogg', // SPRINT-36: Android/web recorder Ogg container
] as const; // SPRINT-36: preserve exact allowlist values

export const AUDIO_MAX_SIZE_BYTES = 15 * 1024 * 1024; // SPRINT-36: allow up to ten minutes of typical compressed voice audio with overhead

function audioMagicMatches(buffer: Buffer, mimeType: string): boolean {
  // SPRINT-36: reject renamed non-audio uploads using container signatures
  if (buffer.length < 4) return false; // SPRINT-36: every supported signature requires at least four bytes
  if (['audio/mp4', 'audio/x-m4a', 'audio/3gpp'].includes(mimeType)) {
    // SPRINT-36: recognize ISO base media containers
    return (
      // SPRINT-36: require the standard ftyp box marker
      buffer.length >= 8 && // SPRINT-36: ensure marker offsets exist
      buffer[4] === 0x66 && // SPRINT-36: match f
      buffer[5] === 0x74 && // SPRINT-36: match t
      buffer[6] === 0x79 && // SPRINT-36: match y
      buffer[7] === 0x70 // SPRINT-36: match p
    ); // SPRINT-36: complete ISO media signature check
  } // SPRINT-36: complete ISO media branch
  if (mimeType === 'audio/mpeg') {
    // SPRINT-36: recognize ID3-tagged or frame-synchronized MPEG audio
    return (
      // SPRINT-36: accept either valid common MPEG prefix
      (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) || // SPRINT-36: match ID3
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) // SPRINT-36: match MPEG frame synchronization
    ); // SPRINT-36: complete MPEG signature check
  } // SPRINT-36: complete MPEG branch
  if (mimeType === 'audio/aac') {
    // SPRINT-36: recognize raw ADTS AAC
    return buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0; // SPRINT-36: match the ADTS synchronization bits
  } // SPRINT-36: complete AAC branch
  if (mimeType === 'audio/ogg') {
    // SPRINT-36: recognize Ogg containers
    return buffer.subarray(0, 4).toString('ascii') === 'OggS'; // SPRINT-36: match the Ogg capture pattern
  } // SPRINT-36: complete Ogg branch
  if (mimeType === 'audio/webm') {
    // SPRINT-36: recognize WebM's EBML header
    return (
      // SPRINT-36: require the four-byte EBML marker
      buffer[0] === 0x1a && // SPRINT-36: match EBML byte one
      buffer[1] === 0x45 && // SPRINT-36: match EBML byte two
      buffer[2] === 0xdf && // SPRINT-36: match EBML byte three
      buffer[3] === 0xa3 // SPRINT-36: match EBML byte four
    ); // SPRINT-36: complete WebM signature check
  } // SPRINT-36: complete WebM branch
  return false; // SPRINT-36: reject every container outside the explicit contract
} // SPRINT-36: complete audio magic validation

const MAGIC: Array<{ mime: string; check: (buf: Buffer) => boolean }> = [
  {
    mime: 'image/jpeg',
    check: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    check: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47,
  },
  {
    mime: 'image/gif',
    check: (b) =>
      b.length >= 6 &&
      b[0] === 0x47 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x38,
  },
  {
    mime: 'application/pdf',
    check: (b) =>
      b.length >= 4 &&
      b[0] === 0x25 &&
      b[1] === 0x50 &&
      b[2] === 0x44 &&
      b[3] === 0x46,
  },
  {
    mime: 'image/webp',
    check: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
  {
    mime: 'video/mp4',
    check: (b) =>
      b.length >= 8 &&
      b[4] === 0x66 &&
      b[5] === 0x74 &&
      b[6] === 0x79 &&
      b[7] === 0x70,
  },
  {
    mime: 'video/webm',
    check: (b) =>
      b.length >= 4 &&
      b[0] === 0x1a &&
      b[1] === 0x45 &&
      b[2] === 0xdf &&
      b[3] === 0xa3,
  },
  {
    mime: 'video/quicktime',
    check: (b) =>
      b.length >= 8 &&
      b[4] === 0x66 &&
      b[5] === 0x74 &&
      b[6] === 0x79 &&
      b[7] === 0x71,
  },
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
    this.cloudName = this.configService.get<string>(
      'CLOUDINARY_CLOUD_NAME',
      '',
    );
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
      'audio/mp4': 'm4a', // SPRINT-36: preserve the MPEG-4 audio container extension
      'audio/x-m4a': 'm4a', // SPRINT-36: normalize the iOS MIME alias to M4A
      'audio/mpeg': 'mp3', // SPRINT-36: preserve standard MPEG audio extension
      'audio/aac': 'aac', // SPRINT-36: preserve raw AAC extension
      'audio/3gpp': '3gp', // SPRINT-36: preserve Android 3GP extension
      'audio/webm': 'webm', // SPRINT-36: preserve WebM extension
      'audio/ogg': 'ogg', // SPRINT-36: preserve Ogg extension
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

  getReadUrlForClient(
    stored: string | null | undefined,
    _expiresInSeconds = 7200,
  ): Promise<string> {
    return Promise.resolve(this.resolvePublicUrl(stored));
  }

  private resourceTypeFromMime(mimeType: string): 'image' | 'video' {
    if (mimeType.startsWith('video/') || mimeType.startsWith('audio/'))
      return 'video'; // SPRINT-36: Cloudinary delivers audio through its video resource type
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
          if (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Cloudinary upload failed';
            reject(new Error(message));
          } else if (!result)
            reject(new Error('Cloudinary upload returned no result'));
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

  async uploadAudio(
    // SPRINT-36: provide a dedicated validated voice-note upload path
    file: Express.Multer.File, // SPRINT-36: accept the multipart file from the authenticated controller
    userId: string, // SPRINT-36: scope the generated public key to its uploader
  ): Promise<{ url: string; key: string }> {
    // SPRINT-36: return both playback URL and storage key
    if (
      !AUDIO_MIME_TYPES.includes(
        file.mimetype as (typeof AUDIO_MIME_TYPES)[number],
      )
    ) {
      // SPRINT-36: reject declared media types outside the audio allowlist
      throw new BadRequestException( // SPRINT-36: provide a type-specific client error
        `Unsupported audio type: ${file.mimetype || 'missing MIME type'}`, // SPRINT-36: name the exact validation reason
      ); // SPRINT-36: complete invalid-type exception
    } // SPRINT-36: complete declared MIME validation
    if (file.size > AUDIO_MAX_SIZE_BYTES) {
      // SPRINT-36: enforce the voice-note size ceiling
      throw new BadRequestException('Audio file must be at most 15MB'); // SPRINT-36: name the exact size validation reason
    } // SPRINT-36: complete size validation
    if (!audioMagicMatches(file.buffer, file.mimetype)) {
      // SPRINT-36: verify bytes agree with the declared supported container
      throw new BadRequestException( // SPRINT-36: distinguish content mismatch from size failure
        `Audio content does not match declared type ${file.mimetype}`, // SPRINT-36: name the exact type mismatch
      ); // SPRINT-36: complete content-type exception
    } // SPRINT-36: complete audio content validation
    const extension = StorageService.extensionFromMime(file.mimetype); // SPRINT-36: choose the documented extension for the accepted MIME
    const key = `messages/audio/${userId}/${randomUUID()}`; // SPRINT-36: use a dedicated public prefix and unguessable component
    const result = await this.uploadBuffer(
      // SPRINT-36: upload through the existing Cloudinary transport
      file.buffer, // SPRINT-36: provide validated audio bytes
      file.mimetype, // SPRINT-36: preserve the validated audio MIME
      key, // SPRINT-36: store under the dedicated audio prefix
      extension, // SPRINT-36: preserve the playable container extension
      'upload', // SPRINT-36: match existing public message-attachment visibility
    ); // SPRINT-36: complete public audio upload
    return { url: result.secure_url, key }; // SPRINT-36: expose playback URL and deletion/storage key
  } // SPRINT-36: complete dedicated audio upload method

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
    await this.uploadBuffer(
      buffer,
      authoritativeMimeType,
      publicId,
      extension,
      'private',
    );
    return `${resourceType}:${extension}:${publicId}`;
  }

  // SPRINT-55: server-generated JSON export — private Cloudinary raw; no public URL
  async uploadPrivateGeneratedJson(
    buffer: Buffer,
    folder: string,
    fileUuid: string,
  ): Promise<string> {
    const publicId = `${folder}/${fileUuid}`;
    await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: 'raw',
          type: 'private',
          format: 'json',
          overwrite: true,
        },
        (error, result) => {
          if (error) {
            reject(
              error instanceof Error
                ? error
                : new Error('Cloudinary private JSON upload failed'),
            );
          } else if (!result) {
            reject(new Error('Cloudinary upload returned no result'));
          } else resolve(result);
        },
      );
      stream.end(buffer);
    });
    return `raw:json:${publicId}`;
  }

  getSignedUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    const parts = objectKey.split(':');
    if (parts.length !== 3) {
      throw new BadRequestException({
        code: 'FILE_INVALID_KEY',
        message: 'Invalid document key format.',
      });
    }
    const [resourceType, extension, publicId] = parts;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return Promise.resolve(
      cloudinary.utils.private_download_url(publicId, extension, {
        resource_type: resourceType,
        type: 'private',
        expires_at: expiresAt,
      }),
    );
  }

  private parseCloudinaryUrl(url: string): {
    resourceType: string;
    publicId: string;
    type: 'upload' | 'private';
  } | null {
    const match = url.match(CLOUDINARY_URL_PATTERN);
    if (!match) return null;
    const deliverySegment = url.includes('/private/') ? 'private' : 'upload';
    return {
      resourceType: match[1],
      publicId: match[2],
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
