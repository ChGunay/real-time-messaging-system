const rabbitMQConnection = require('../../config/rabbitmq');
const { Message, Conversation, AutoMessage } = require('../../models');
const { userOnlineService } = require('../redis');
const logger = require('../../utils/logger');

class MessageConsumer {
  constructor() {
    this.isConsuming = false;
    this.maxRetries = 3;
    this.retryDelay = 5000; 
  }

  getConsumerChannel() {
    return rabbitMQConnection.getConsumerChannel();
  }

  async startConsuming() {
    try {
      if (this.isConsuming) {
        logger.warn('Message consumer is already running');
        return;
      }

      const channel = this.getConsumerChannel();
      const queueName = process.env.MESSAGE_SENDING_QUEUE || 'message_sending_queue';

      logger.info(`Starting message consumer for queue: ${queueName}`);

      await channel.consume(queueName, async (msg) => {
        if (msg === null) {
          logger.warn('Received null message from queue');
          return;
        }

        try {
          const messageData = JSON.parse(msg.content.toString());
          logger.debug('Processing message from queue:', messageData);

          await this.processMessage(messageData);
          
          
          channel.ack(msg);
          
        } catch (error) {
          logger.error('Error processing message:', error);
          
          
          const retryCount = this.getRetryCount(msg);
          
          if (retryCount < this.maxRetries) {
            logger.info(`Retrying message (attempt ${retryCount + 1}/${this.maxRetries})`);
            
            
            setTimeout(() => {
              channel.nack(msg, false, true);
            }, this.retryDelay);
          } else {
            logger.error('Max retries reached, sending to dead letter queue');
            
            
            await this.sendToDeadLetterQueue(messageData, error.message);
            channel.ack(msg);
          }
        }
      }, {
        noAck: false 
      });

      this.isConsuming = true;
      logger.info('Message consumer started successfully');

    } catch (error) {
      logger.error('Error starting message consumer:', error);
      throw error;
    }
  }

  async processMessage(messageData) {
    try {
      if (messageData.type === 'auto_message') {
        await this.processAutoMessage(messageData.payload);
      } else {
        logger.warn('Unknown message type:', messageData.type);
      }
    } catch (error) {
      logger.error('Error in processMessage:', error);
      throw error;
    }
  }

  async processAutoMessage(payload) {
    try {
      const { autoMessageId, senderId, receiverId, content } = payload;

      logger.info(`Processing auto message: ${autoMessageId} from ${senderId} to ${receiverId}`);

      
      let conversation = await Conversation.findBetweenUsers(senderId, receiverId);
      
      if (!conversation) {
        conversation = new Conversation({
          participants: [senderId, receiverId],
          conversationType: 'direct',
          metadata: {
            createdBy: senderId
          }
        });
        await conversation.save();
        logger.debug(`Created new conversation: ${conversation._id}`);
      }

      
      const message = new Message({
        conversation: conversation._id,
        sender: senderId,
        content: content,
        messageType: 'text',
        isSystemMessage: false
      });

      await message.save();
      logger.debug(`Created message: ${message._id}`);

      
      await conversation.updateLastMessage(message._id);

      
      await AutoMessage.findByIdAndUpdate(autoMessageId, {
        isSent: true,
        sentAt: new Date(),
        messageId: message._id,
        conversationId: conversation._id
      });

      
      await this.sendRealtimeNotification(receiverId, {
        type: 'message_received',
        message: {
          _id: message._id,
          conversation: conversation._id,
          sender: {
            _id: senderId
          },
          content: content,
          messageType: 'text',
          createdAt: message.createdAt
        },
        conversation: {
          _id: conversation._id,
          participants: conversation.participants
        }
      });

      logger.info(`Auto message processed successfully: ${autoMessageId}`);

    } catch (error) {
      logger.error('Error processing auto message:', error);
      

      if (payload.autoMessageId) {
        try {
          await AutoMessage.findByIdAndUpdate(payload.autoMessageId, {
            $inc: { retryCount: 1 },
            errorMessage: error.message
          });
        } catch (updateError) {
          logger.error('Error updating AutoMessage with error:', updateError);
        }
      }
      
      throw error;
    }
  }

  async sendRealtimeNotification(userId, notificationData) {
    try {
      
      const isOnline = await userOnlineService.isUserOnline(userId);
      
      if (!isOnline) {
        logger.debug(`User ${userId} is offline, skipping real-time notification`);
        return;
      }

      
      const io = global.socketIO;
      
      if (io) {
        
        const socketId = await userOnlineService.getUserSocketId(userId);
        
        if (socketId) {
          io.to(socketId).emit('message_received', notificationData);
          logger.debug(`Real-time notification sent to user ${userId}`);
        } else {
          logger.debug(`No socket ID found for user ${userId}`);
        }
      } else {
        logger.warn('Socket.IO instance not available');
      }

    } catch (error) {
      logger.error('Error sending real-time notification:', error);
      
    }
  }

  async sendToDeadLetterQueue(messageData, errorMessage) {
    try {
      const channel = this.getConsumerChannel();
      const deadLetterQueue = 'failed_messages_dlq';
      
      const failedMessage = {
        originalMessage: messageData,
        error: errorMessage,
        timestamp: Date.now(),
        id: `failed-${Date.now()}-${Math.random()}`
      };

      const messageBuffer = Buffer.from(JSON.stringify(failedMessage));
      
      channel.sendToQueue(deadLetterQueue, messageBuffer, {
        persistent: true,
        timestamp: Date.now()
      });

      logger.error('Message sent to dead letter queue:', {
        originalMessageId: messageData.id,
        error: errorMessage
      });

    } catch (error) {
      logger.error('Error sending message to dead letter queue:', error);
    }
  }

  getRetryCount(msg) {
    const headers = msg.properties.headers || {};
    return headers['x-retry-count'] || 0;
  }

  async stopConsuming() {
    try {
      if (!this.isConsuming) {
        logger.warn('Message consumer is not running');
        return;
      }

      const channel = this.getConsumerChannel();
      await channel.cancel(); 
      
      this.isConsuming = false;
      logger.info('Message consumer stopped');

    } catch (error) {
      logger.error('Error stopping message consumer:', error);
      throw error;
    }
  }

  async getConsumerStats() {
    try {
      const queueName = process.env.MESSAGE_SENDING_QUEUE || 'message_sending_queue';
      const stats = await rabbitMQConnection.getQueueStats(queueName);
      
      return {
        queueName,
        messageCount: stats ? stats.messageCount : 0,
        consumerCount: stats ? stats.consumerCount : 0,
        isConsuming: this.isConsuming,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Error getting consumer stats:', error);
      return {
        error: error.message,
        isConsuming: this.isConsuming,
        timestamp: Date.now()
      };
    }
  }

    
  async healthCheck() {
    try {
      const isHealthy = rabbitMQConnection.isHealthy() && this.isConsuming;
      const stats = await this.getConsumerStats();
      
      return {
        isHealthy,
        isConsuming: this.isConsuming,
        stats,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Consumer health check failed:', error);
      return {
        isHealthy: false,
        isConsuming: this.isConsuming,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }
}

module.exports = new MessageConsumer();