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

// Apply protect middleware to all routes
router.use(protect);

// Popular feed
router.get('/feed/popular', getPopularFeed);

// Character CRUD routes
router.route('/')
  .post(createCharacter)
  .get(listCharacters);

router.route('/:id')
  .get(getCharacter)
  .put(updateCharacter)
  .delete(deleteCharacter);

// Upload character avatar
router.post('/:id/avatar', upload.single('avatar'), uploadAvatar);
router.post('/:id/avatar/generate', generateCharacterAvatar);

// Popularity interactions
router.post('/:id/like', likeCharacter);
router.delete('/:id/like', unlikeCharacter);
router.post('/:id/share', shareCharacter);
router.post('/:id/use', useCharacter);

export default router;
