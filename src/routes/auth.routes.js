import express from 'express';
import { 
  signup, 
  login, 
  protect, 
  getCurrentUser, 
  updateUser, 
  deleteUser,
  uploadAvatar,
  deleteAvatar,
  sendEmailVerification,
  verifyEmailOtp,
  sendPhoneVerification,
  verifyPhoneOtp
} from '../controllers/auth.controller.js';
import { uploadSingle } from '../middleware/upload.js';

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
router.post('/me/avatar', uploadSingle('avatar'), uploadAvatar);
router.delete('/me/avatar', deleteAvatar);

// Email verification (OTP)
router.post('/verify/email/send', sendEmailVerification);
router.post('/verify/email/resend', sendEmailVerification);
router.post('/verify/email/confirm', verifyEmailOtp);

// Phone (WhatsApp) verification (OTP)
router.post('/verify/phone/send', sendPhoneVerification);
router.post('/verify/phone/confirm', verifyPhoneOtp);

export default router;
