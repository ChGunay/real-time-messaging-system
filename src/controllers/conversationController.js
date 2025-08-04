const { Conversation, Message, User } = require('../models');
const { cacheService } = require('../services/redis');
const logger = require('../utils/logger');

class ConversationController {

  async getConversations(req, res) {
    try {
      const userId = req.user.id;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;


      const cacheKey = `user_conversations:${userId}:page:${page}:limit:${limit}`;
      const cachedResult = await cacheService.get(cacheKey);

      if (cachedResult) {
        return res.json({
          success: true,
          data: cachedResult
        });
      }


      const conversations = await Conversation.findUserConversations(userId, page, limit);
      
      const totalConversations = await Conversation.countDocuments({
        participants: userId,
        isActive: true
      });

      const totalPages = Math.ceil(totalConversations / limit);

      const result = {
        conversations,
        pagination: {
          currentPage: page,
          totalPages,
          totalConversations,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      };


      await cacheService.set(cacheKey, result, 300); 

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Get conversations error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get conversations'
      });
    }
  }


  async createConversation(req, res) {
    try {
      const { participantId } = req.body;
      const userId = req.user.id;


      const existingConversation = await Conversation.findBetweenUsers(userId, participantId);

      if (existingConversation) {
        return res.json({
          success: true,
          data: {
            conversation: existingConversation,
            isNew: false
          }
        });
      }


      const participant = await User.findById(participantId).select('username email isActive');
      
      if (!participant || !participant.isActive) {
        return res.status(404).json({
          success: false,
          message: 'Participant not found or inactive'
        });
      }


      const conversation = new Conversation({
        participants: [userId, participantId],
        conversationType: 'direct',
        metadata: {
          createdBy: userId
        }
      });

      await conversation.save();
      

      await conversation.populate('participants', 'username email lastSeen');


      await cacheService.invalidateUserConversations(userId);
      await cacheService.invalidateUserConversations(participantId);

      logger.info(`New conversation created between ${req.user.username} and ${participant.username}`);

      res.status(201).json({
        success: true,
        message: 'Conversation created successfully',
        data: {
          conversation,
          isNew: true
        }
      });

    } catch (error) {
      logger.error('Create conversation error:', error);
      
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid participant ID'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to create conversation'
      });
    }
  }


  async getConversation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;


      const cachedConversation = await cacheService.getCachedConversation(id);
      
      if (cachedConversation) {

        const isParticipant = cachedConversation.participants.some(
          p => p._id.toString() === userId
        );
        
        if (!isParticipant) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }

        return res.json({
          success: true,
          data: { conversation: cachedConversation }
        });
      }


      const conversation = await Conversation.findOne({
        _id: id,
        participants: userId,
        isActive: true
      }).populate('participants', 'username email lastSeen')
        .populate('lastMessage');

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: 'Conversation not found'
        });
      }


      await cacheService.cacheConversation(id, conversation);

      res.json({
        success: true,
        data: { conversation }
      });

    } catch (error) {
      logger.error('Get conversation error:', error);
      
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid conversation ID'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to get conversation'
      });
    }
  }


  async getConversationMessages(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;


      const conversation = await Conversation.findOne({
        _id: id,
        participants: userId,
        isActive: true
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: 'Conversation not found'
        });
      }


      const cachedMessages = await cacheService.getCachedConversationMessages(id, page);
      
      if (cachedMessages) {
        return res.json({
          success: true,
          data: cachedMessages
        });
      }


      const messages = await Message.getConversationMessages(id, page, limit);
      
      const totalMessages = await Message.countDocuments({
        conversation: id,
        isDeleted: false
      });

      const totalPages = Math.ceil(totalMessages / limit);

      const result = {
        messages: messages.reverse(), 
        pagination: {
          currentPage: page,
          totalPages,
          totalMessages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      };


      await cacheService.cacheConversationMessages(id, page, result);

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Get conversation messages error:', error);
      
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid conversation ID'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to get messages'
      });
    }
  }


  async sendMessage(req, res) {
    try {
      const { id: conversationId } = req.params;
      const { content, replyTo } = req.body;
      const userId = req.user.id;


      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
        isActive: true
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: 'Conversation not found'
        });
      }

      
      const message = new Message({
        conversation: conversationId,
        sender: userId,
        content: content.trim(),
        messageType: 'text',
        replyTo: replyTo || undefined
      });

      await message.save();

      
      await conversation.updateLastMessage(message._id);

      
      await message.populate('sender', 'username email');
      if (replyTo) {
        await message.populate('replyTo', 'content sender createdAt');
      }

      
      await cacheService.invalidateConversationMessages(conversationId);
      await cacheService.invalidateConversation(conversationId);

      
      for (const participantId of conversation.participants) {
        await cacheService.invalidateUserConversations(participantId.toString());
      }

      logger.info(`Message sent by ${req.user.username} in conversation ${conversationId}`);

      res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: { message }
      });

    } catch (error) {
      logger.error('Send message error:', error);
      
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid conversation ID'
        });
      }

      if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(err => ({
          field: err.path,
          message: err.message
        }));
        
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to send message'
      });
    }
  }

  
  async markMessageAsRead(req, res) {
    try {
      const { id: conversationId, messageId } = req.params;
      const userId = req.user.id;

      
      const message = await Message.findOne({
        _id: messageId,
        conversation: conversationId
      }).populate('conversation', 'participants');

      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      
      if (!message.conversation.participants.includes(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      
      await message.markAsRead(userId);

      res.json({
        success: true,
        message: 'Message marked as read'
      });

    } catch (error) {
      logger.error('Mark message as read error:', error);
      
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid ID format'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to mark message as read'
      });
    }
  }

  
  async deleteConversation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      
      const conversation = await Conversation.findOne({
        _id: id,
        participants: userId,
        isActive: true
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: 'Conversation not found'
        });
      }


      conversation.isActive = false;
      await conversation.save();

      
      await cacheService.invalidateConversation(id);
      for (const participantId of conversation.participants) {
        await cacheService.invalidateUserConversations(participantId.toString());
      }

      logger.info(`Conversation ${id} deleted by user ${userId}`);

      res.json({
        success: true,
        message: 'Conversation deleted successfully'
      });

    } catch (error) {
      logger.error('Delete conversation error:', error);
      
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid conversation ID'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to delete conversation'
      });
    }
  }
}

module.exports = new ConversationController();