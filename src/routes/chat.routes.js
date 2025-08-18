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
  .get(chatController.getUserSessions)
  .delete(chatController.deleteAllUserSessions);

// Create a session with a PUBLIC character (no owner mirroring)
router.route('/public/sessions')
  .post(chatController.createPublicCharacterSession);

router.route('/sessions/:sessionId')
  .get(chatController.getSession)
  .patch(chatController.updateSession)
  .delete(chatController.deleteSession);

// Message routes
router.route('/send')
  .post(chatController.sendMessage);

router.route('/sessions/:sessionId/messages')
  .get(chatController.getSessionMessages)
  .delete(chatController.clearSessionMessages);

// Clear all messages for a user's chats with a character
router.route('/characters/:characterId/messages')
  .delete(chatController.clearMessagesForCharacter);

// Delete a character (owner only) and cascade user's sessions/messages with it
router.route('/characters/:characterId')
  .delete(chatController.deleteCharacterWithSessions);

// Delete a single message
router.route('/messages/:messageId')
  .delete(chatController.deleteMessage);

export default router;
