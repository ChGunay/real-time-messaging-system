const express = require('express');
const conversationController = require('../controllers/conversationController');
const { authenticate, authorizeConversationAccess } = require('../middleware/auth');
const { 
  validate, 
  validateQuery, 
  validateParams,
  paginationSchema, 
  objectIdSchema,
  createConversationSchema,
  sendMessageSchema 
} = require('../middleware/validation');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateConversationRequest:
 *       type: object
 *       required:
 *         - participantId
 *       properties:
 *         participantId:
 *           type: string
 *           format: objectId
 *           description: ID of the user to start conversation with
 *       example:
 *         participantId: 507f1f77bcf86cd799439011
 *     
 *     SendMessageRequest:
 *       type: object
 *       required:
 *         - content
 *       properties:
 *         content:
 *           type: string
 *           minLength: 1
 *           maxLength: 1000
 *           description: Message content
 *         messageType:
 *           type: string
 *           enum: [text, auto]
 *           default: text
 *           description: Type of message
 *       example:
 *         content: Hello, how are you?
 *         messageType: text
 *     
 *     ConversationList:
 *       type: object
 *       properties:
 *         conversations:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Conversation'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMeta'
 *       example:
 *         conversations: []
 *         meta:
 *           page: 1
 *           limit: 10
 *           total: 0
 *           totalPages: 0
 *           hasNext: false
 *           hasPrev: false
 *     
 *     MessageList:
 *       type: object
 *       properties:
 *         messages:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Message'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMeta'
 *       example:
 *         messages: []
 *         meta:
 *           page: 1
 *           limit: 20
 *           total: 0
 *           totalPages: 0
 *           hasNext: false
 *           hasPrev: false
 */

const router = express.Router();

// Rate limiting for conversation endpoints
const conversationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  message: {
    success: false,
    message: 'Too many conversation requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Message sending rate limiting (more restrictive)
const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 messages per minute
  message: {
    success: false,
    message: 'Too many messages, please slow down'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply authentication to all routes
router.use(authenticate);
router.use(conversationLimiter);

/**
 * @swagger
 * /api/conversations:
 *   get:
 *     summary: Get user's conversations
 *     tags: [Conversations]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: User's conversations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/ConversationList'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get('/',
  validateQuery(paginationSchema),
  conversationController.getConversations
);

/**
 * @swagger
 * /api/conversations:
 *   post:
 *     summary: Create new conversation
 *     tags: [Conversations]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateConversationRequest'
 *     responses:
 *       201:
 *         description: Conversation created successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Conversation'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Participant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Conversation already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post('/',
  validate(createConversationSchema),
  conversationController.createConversation
);

/**
 * @swagger
 * /api/conversations/{id}:
 *   get:
 *     summary: Get specific conversation details
 *     tags: [Conversations]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Conversation ID
 *         schema:
 *           type: string
 *           format: objectId
 *           example: 507f1f77bcf86cd799439011
 *     responses:
 *       200:
 *         description: Conversation details
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Conversation'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Access denied to this conversation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Conversation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id',
  validateParams(objectIdSchema),
  conversationController.getConversation
);

/**
 * @swagger
 * /api/conversations/{id}/messages:
 *   get:
 *     summary: Get conversation messages
 *     tags: [Messages]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Conversation ID
 *         schema:
 *           type: string
 *           format: objectId
 *           example: 507f1f77bcf86cd799439011
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: Conversation messages retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/MessageList'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Access denied to this conversation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Conversation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id/messages',
  validateParams(objectIdSchema),
  validateQuery(paginationSchema),
  conversationController.getConversationMessages
);

/**
 * @swagger
 * /api/conversations/{id}/messages:
 *   post:
 *     summary: Send message to conversation
 *     tags: [Messages]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Conversation ID
 *         schema:
 *           type: string
 *           format: objectId
 *           example: 507f1f77bcf86cd799439011
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendMessageRequest'
 *     responses:
 *       201:
 *         description: Message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Message'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Access denied to this conversation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Conversation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post('/:id/messages',
  messageLimiter,
  validateParams(objectIdSchema),
  validate(sendMessageSchema),
  conversationController.sendMessage
);

/**
 * @swagger
 * /api/conversations/{id}/messages/{messageId}/read:
 *   put:
 *     summary: Mark message as read
 *     tags: [Messages]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Conversation ID
 *         schema:
 *           type: string
 *           format: objectId
 *           example: 507f1f77bcf86cd799439011
 *       - name: messageId
 *         in: path
 *         required: true
 *         description: Message ID
 *         schema:
 *           type: string
 *           format: objectId
 *           example: 507f1f77bcf86cd799439012
 *     responses:
 *       200:
 *         description: Message marked as read successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Access denied to this conversation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Conversation or message not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/:id/messages/:messageId/read',
  validateParams(Joi.object({
    id: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    messageId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required()
  })),
  conversationController.markMessageAsRead
);

/**
 * @swagger
 * /api/conversations/{id}:
 *   delete:
 *     summary: Delete conversation
 *     tags: [Conversations]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Conversation ID
 *         schema:
 *           type: string
 *           format: objectId
 *           example: 507f1f77bcf86cd799439011
 *     responses:
 *       200:
 *         description: Conversation deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Access denied to this conversation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Conversation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:id',
  validateParams(objectIdSchema),
  conversationController.deleteConversation
);

module.exports = router;