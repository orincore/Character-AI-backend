import AppError from '../utils/appError.js';
import * as chatService from '../services/chat.service.js';

/**
 * @desc    Create a new chat session
 * @route   POST /api/v1/chat/sessions
 * @access  Private
 */
export const createSession = async (req, res, next) => {
  try {
    const { characterId, title } = req.body;
    const userId = req.user.id;

    if (!characterId) {
      throw new AppError('Character ID is required', 400);
    }

    const session = await chatService.createSession(userId, characterId, title);
    
    res.status(201).json({
      status: 'success',
      data: {
        session
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a single message by ID (ownership enforced)
 * @route   DELETE /api/v1/chat/messages/:messageId
 * @access  Private
 */
export const deleteMessage = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    if (!messageId) {
      throw new AppError('Message ID is required', 400);
    }

    await chatService.deleteMessage(messageId, userId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Clear all messages across this user's sessions with a specific character
 * @route   DELETE /api/v1/chat/characters/:characterId/messages
 * @access  Private
 */
export const clearMessagesForCharacter = async (req, res, next) => {
  try {
    const { characterId } = req.params;
    const userId = req.user.id;

    if (!characterId) {
      throw new AppError('Character ID is required', 400);
    }

    await chatService.clearChatWithCharacter(userId, characterId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Clear all messages in a session (keeps the session)
 * @route   DELETE /api/v1/chat/sessions/:sessionId/messages
 * @access  Private
 */
export const clearSessionMessages = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    if (!sessionId) {
      throw new AppError('Session ID is required', 400);
    }

    await chatService.clearSessionMessages(sessionId, userId);

    // No content on success
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get chat session details
 * @route   GET /api/v1/chat/sessions/:sessionId
 * @access  Private
 */
export const getSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await chatService.getSession(sessionId, userId);
    
    res.status(200).json({
      status: 'success',
      data: {
        session
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all chat sessions for the authenticated user
 * @route   GET /api/v1/chat/sessions
 * @access  Private
 */
export const getUserSessions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const sessions = await chatService.listUserSessions(userId);
    
    res.status(200).json({
      status: 'success',
      results: sessions.length,
      data: {
        sessions
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Send a message in a chat session
 * @route   POST /api/v1/chat/send
 * @access  Private
 */
export const sendMessage = async (req, res, next) => {
  try {
    const { sessionId, message } = req.body;
    const userId = req.user.id;

    if (!sessionId || !message) {
      throw new AppError('Session ID and message are required', 400);
    }

    const result = await chatService.sendMessage(sessionId, userId, message);
    
    res.status(200).json({
      status: 'success',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get chat history for a session
 * @route   GET /api/v1/chat/sessions/:sessionId/messages
 * @access  Private
 */
export const getSessionMessages = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    const userId = req.user?.id;

    console.log('Fetching messages for session:', { 
      sessionId, 
      userId,
      limit,
      offset,
      timestamp: new Date().toISOString()
    });

    if (!sessionId) {
      throw new AppError('Session ID is required', 400);
    }

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const { messages, pagination } = await chatService.getSessionMessages(
      sessionId, 
      userId, 
      { 
        limit: parseInt(limit, 10) || 50,
        offset: parseInt(offset, 10) || 0
      }
    );
    
    console.log(`Found ${messages.length} messages for session ${sessionId}`);
    
    res.status(200).json({
      status: 'success',
      data: {
        messages,
        pagination
      }
    });
  } catch (error) {
    console.error('Error in getSessionMessages:', {
      error: error.message,
      stack: error.stack,
      params: req.params,
      query: req.query,
      userId: req.user?.id
    });
    next(error);
  }
};

/**
 * @desc    Update chat session (e.g., title)
 * @route   PATCH /api/v1/chat/sessions/:sessionId
 * @access  Private
 */
export const updateSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { title } = req.body;
    const userId = req.user.id;

    if (!title) {
      throw new AppError('Title is required', 400);
    }

    const session = await chatService.updateSession(sessionId, userId, { title });
    
    res.status(200).json({
      status: 'success',
      data: {
        session
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a chat session and its messages
 * @route   DELETE /api/v1/chat/sessions/:sessionId
 * @access  Private
 */
export const deleteSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    await chatService.deleteSession(sessionId, userId);
    
    res.status(204).json({
      status: 'success',
      data: null
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete ALL chat sessions and their messages for the authenticated user
 * @route   DELETE /api/v1/chat/sessions
 * @access  Private
 */
export const deleteAllUserSessions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    await chatService.deleteAllUserSessions(userId);
    res.status(204).json({ status: 'success', data: null });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a character (owner only) and cascade delete the user's sessions/messages with it
 * @route   DELETE /api/v1/chat/characters/:characterId
 * @access  Private
 */
export const deleteCharacterWithSessions = async (req, res, next) => {
  try {
    const { characterId } = req.params;
    const userId = req.user.id;

    if (!characterId) {
      throw new AppError('Character ID is required', 400);
    }

    await chatService.deleteCharacterWithSessions(userId, characterId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a character and all of this user's sessions/messages with it (owner only)
 * @route   DELETE /api/v1/chat/characters/:characterId
 * @access  Private
 */
// (duplicate removed)
