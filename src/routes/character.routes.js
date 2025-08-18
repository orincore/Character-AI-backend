import express from 'express';
import multer from 'multer';
import { 
  createCharacter, 
  getCharacter, 
  updateCharacter, 
  deleteCharacter, 
  listCharacters,
  uploadAvatar,
  generateCharacterAvatar,
  likeCharacter,
  unlikeCharacter,
  shareCharacter,
  useCharacter,
  getPopularFeed
} from '../controllers/character.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// Popular feed (protected)
router.get('/feed/popular', protect, getPopularFeed);

// Character CRUD routes
router.route('/')
  .post(protect, createCharacter)
  .get(protect, listCharacters);

// Public: Get character by id
router.get('/:id', getCharacter);

// Protected: update and delete
router.put('/:id', protect, updateCharacter);
router.delete('/:id', protect, deleteCharacter);

// Upload character avatar (protected)
router.post('/:id/avatar', protect, upload.single('avatar'), uploadAvatar);
router.post('/:id/avatar/generate', protect, generateCharacterAvatar);

// Popularity interactions (protected)
router.post('/:id/like', protect, likeCharacter);
router.delete('/:id/like', protect, unlikeCharacter);
router.post('/:id/share', protect, shareCharacter);
router.post('/:id/use', protect, useCharacter);

export default router;
