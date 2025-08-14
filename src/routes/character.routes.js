import express from 'express';
import multer from 'multer';
import { 
  createCharacter, 
  getCharacter, 
  updateCharacter, 
  deleteCharacter, 
  listCharacters,
  uploadAvatar
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

export default router;
