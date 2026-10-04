import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const DOWNLOAD_URL_TTL_SECONDS = 900;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async listMyDocuments(userId: string) {
    const documents = await this.prisma.userDocument.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        title: true,
        mimeType: true,
        sizeBytes: true,
        propertyApplicationId: true,
        createdAt: true,
      },
    });
    return documents;
  }

  async getDownloadUrl(userId: string, documentId: string) {
    const document = await this.prisma.userDocument.findUnique({
      where: { id: documentId },
      select: { userId: true, fileKey: true },
    });
    // Other users' documents are reported as missing rather than forbidden.
    if (!document || document.userId !== userId) {
      throw new NotFoundException('Document not found');
    }
    const url = await this.storageService.getSignedUrl(
      document.fileKey,
      DOWNLOAD_URL_TTL_SECONDS,
    );
    return { url, expiresIn: DOWNLOAD_URL_TTL_SECONDS };
  }
}
