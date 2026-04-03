import { memoryStorage } from 'multer';

export const multerConfig = {
  storage: memoryStorage(),
  // No global file size limits - routes set their own via MulterModule
};
