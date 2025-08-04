const { userOnlineService } = require('../redis');
const { Conversation, Message } = require('../../models');
const logger = require('../../utils/logger');

class SocketHandler {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map(); 
  }

  async handleConnection(socket) {
    try {
      const userId = socket.userId;
      const username = socket.user.username;

      logger.info(`User connected: ${username} (${socket.id})`);


      this.connectedUsers.set(socket.id, userId);

      
      await userOnlineService.setUserOnline(userId, socket.id);

      
      socket.join(`user:${userId}`);

      
      await this.joinUserConversations(socket, userId);

      
      socket.broadcast.emit('user_online', {
        userId,
        username,
        timestamp: Date.now()
      });

      
      await this.sendInitialData(socket, userId);

      logger.debug(`User ${username} successfully connected and setup completed`);

    } catch (error) {
      logger.error('Error handling socket connection:', error);
      socket.emit('connection_error', {
        message: 'Connection setup failed'
      });
    }
  }

  async handleDisconnection(socket) {
    try {
      const userId = this.connectedUsers.get(socket.id);
      
      if (userId) {
        const username = socket.user?.username || 'Unknown';
        
        logger.info(`User disconnected: ${username} (${socket.id})`);

        
        this.connectedUsers.delete(socket.id);

        
        await userOnlineService.setUserOffline(userId);

        
        socket.broadcast.emit('user_offline', {
          userId,
          username,
          timestamp: Date.now()
        });

        logger.debug(`User ${username} disconnection cleanup completed`);
      }
    } catch (error) {
      logger.error('Error handling socket disconnection:', error);
    }
  }

  async joinUserConversations(socket, userId) {
    try {
      
      const conversations = await Conversation.find({
        participants: userId,
        isActive: true
      }).select('_id').lean();

      
      for (const conversation of conversations) {
        socket.join(`conversation:${conversation._id}`);
      }

      logger.debug(`User ${userId} joined ${conversations.length} conversation rooms`);
    } catch (error) {
      logger.error('Error joining user conversations:', error);
    }
  }

  async sendInitialData(socket, userId) {
    try {
      
      const onlineCount = await userOnlineService.getOnlineUsersCount();

      
      socket.emit('connection_success', {
        message: 'Connected successfully',
        onlineUsersCount: onlineCount,
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('Error sending initial data:', error);
    }
  }

  async handleJoinRoom(socket, data) {
    try {
      const { conversationId } = data;
      const userId = socket.userId;

      
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
        isActive: true
      });

      if (!conversation) {
        socket.emit('join_room_error', {
          message: 'Conversation not found or access denied'
        });
        return;
      }

      
      socket.join(`conversation:${conversationId}`);

      socket.emit('join_room_success', {
        conversationId,
        message: 'Joined conversation successfully'
      });

      logger.debug(`User ${userId} joined conversation room: ${conversationId}`);

    } catch (error) {
      logger.error('Error handling join room:', error);
      socket.emit('join_room_error', {
        message: 'Failed to join conversation'
      });
    }
  }

  async handleSendMessage(socket, data) {
    try {
      const { conversationId, content, replyTo } = data;
      const userId = socket.userId;
      const username = socket.user.username;


      if (!conversationId || !content || content.trim().length === 0) {
        socket.emit('send_message_error', {
          message: 'Conversation ID and content are required'
        });
        return;
      }

      if (content.length > 1000) {
        socket.emit('send_message_error', {
          message: 'Message content too long (max 1000 characters)'
        });
        return;
      }

      
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
        isActive: true
      });

      if (!conversation) {
        socket.emit('send_message_error', {
          message: 'Conversation not found or access denied'
        });
        return;
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

      const messageData = {
        _id: message._id,
        conversation: conversationId,
        sender: {
          _id: message.sender._id,
          username: message.sender.username,
          email: message.sender.email
        },
        content: message.content,
        messageType: message.messageType,
        replyTo: message.replyTo,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
      };

      
      this.io.to(`conversation:${conversationId}`).emit('message_received', {
        message: messageData,
        timestamp: Date.now()
      });

      logger.info(`Message sent by ${username} in conversation ${conversationId}`);

      
      socket.emit('message_sent', {
        messageId: message._id,
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('Error handling send message:', error);
      socket.emit('send_message_error', {
        message: 'Failed to send message'
      });
    }
  }

  async handleTyping(socket, data) {
    try {
      const { conversationId, isTyping } = data;
      const userId = socket.userId;
      const username = socket.user.username;

      
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
        isActive: true
      });

      if (!conversation) {
        return;
      }

      
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        userId,
        username,
        conversationId,
        isTyping,
        timestamp: Date.now()
      });

      logger.debug(`User ${username} ${isTyping ? 'started' : 'stopped'} typing in conversation ${conversationId}`);

    } catch (error) {
      logger.error('Error handling typing:', error);
    }
  }

  async handleMessageRead(socket, data) {
    try {
      const { messageId } = data;
      const userId = socket.userId;

      
      const message = await Message.findById(messageId)
        .populate('conversation', 'participants');

      if (!message) {
        socket.emit('message_read_error', {
          message: 'Message not found'
        });
        return;
      }

      
      if (!message.conversation.participants.includes(userId)) {
        socket.emit('message_read_error', {
          message: 'Access denied'
        });
        return;
      }

      
      await message.markAsRead(userId);

      
      this.io.to(`conversation:${message.conversation._id}`).emit('message_read', {
        messageId: message._id,
        readBy: userId,
        readAt: Date.now()
      });

      logger.debug(`Message ${messageId} marked as read by user ${userId}`);

    } catch (error) {
      logger.error('Error handling message read:', error);
      socket.emit('message_read_error', {
        message: 'Failed to mark message as read'
      });
    }
  }

  async handleGetOnlineUsers(socket) {
    try {
      const onlineUsers = await userOnlineService.getOnlineUsers();
      const onlineCount = await userOnlineService.getOnlineUsersCount();

      socket.emit('online_users', {
        users: onlineUsers,
        count: onlineCount,
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('Error getting online users:', error);
      socket.emit('online_users_error', {
        message: 'Failed to get online users'
      });
    }
  }

  
  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }

  
  getUserSockets(userId) {
    const sockets = [];
    for (const [socketId, connectedUserId] of this.connectedUsers.entries()) {
      if (connectedUserId === userId) {
        sockets.push(socketId);
      }
    }
    return sockets;
  }

  
  async sendToUser(userId, event, data) {
    try {
      this.io.to(`user:${userId}`).emit(event, data);
    } catch (error) {
      logger.error(`Error sending ${event} to user ${userId}:`, error);
    }
  }

  
  async sendToConversation(conversationId, event, data) {
    try {
      this.io.to(`conversation:${conversationId}`).emit(event, data);
    } catch (error) {
      logger.error(`Error sending ${event} to conversation ${conversationId}:`, error);
    }
  }

  
  async broadcast(event, data) {
    try {
      this.io.emit(event, data);
    } catch (error) {
      logger.error(`Error broadcasting ${event}:`, error);
    }
  }
}

module.exports = SocketHandler;