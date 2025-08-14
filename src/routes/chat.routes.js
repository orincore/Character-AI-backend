import express from 'express';
import * as chatController from '../controllers/chat.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { chatRateLimiter, standardRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Protect all routes after this middleware
router.use(protect);

// Apply chat-specific rate limiter to chat endpoints
router.use(chatRateLimiter);

// Session routes
router.route('/sessions')
  .post(chatController.createSession)
  .get(chatController.getUserSessions);

router.route('/sessions/:sessionId')
  .get(chatController.getSession)
  .patch(chatController.updateSession)
  .delete(chatController.deleteSession);

// Message routes
router.route('/send')
  .post(chatController.sendMessage);

router.route('/sessions/:sessionId/messages')
  .get(chatController.getSessionMessages);

export default router;
