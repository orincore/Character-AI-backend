import express from 'express';
import { 
  signup, 
  login, 
  protect, 
  getCurrentUser, 
  updateUser, 
  deleteUser 
} from '../controllers/auth.controller.js';

const router = express.Router();

// Public routes
router.post('/signup', signup);
router.post('/login', login);

// Protected routes - all routes below this middleware require authentication
router.use(protect);

// User management routes
router.get('/me', getCurrentUser);
router.put('/me', updateUser);
router.delete('/me', deleteUser);

export default router;
