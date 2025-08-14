import multer from 'multer';
import path from 'path';
import AppError from '../utils/appError.js';

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.mimetype)) {
    return cb(new AppError('Only image files are allowed (jpeg, png, webp, gif)', 400));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB
});

export const uploadSingle = (fieldName) => upload.single(fieldName);

export default upload;
