const rabbitMQConnection = require('../../config/rabbitmq');
const logger = require('../../utils/logger');

class MessageProducer {
  constructor() {
    this.retryAttempts = 3;
    this.retryDelay = 1000; 
  }

  getPublisherChannel() {
    return rabbitMQConnection.getPublisherChannel();
  }

  async publishToQueue(queueName, message, options = {}) {
    let attempts = 0;
    
    while (attempts < this.retryAttempts) {
      try {
        const channel = this.getPublisherChannel();
        
        const messageBuffer = Buffer.from(JSON.stringify(message));
        const publishOptions = {
          persistent: true,
          timestamp: Date.now(),
          messageId: message.id || `${Date.now()}-${Math.random()}`,
          ...options
        };

        const result = channel.sendToQueue(queueName, messageBuffer, publishOptions);
        
        if (result) {
          logger.debug(`Message published to queue ${queueName}:`, {
            messageId: publishOptions.messageId,
            queueName
          });
          return true;
        } else {
          throw new Error('Failed to publish message to queue');
        }
      } catch (error) {
        attempts++;
        logger.error(`Attempt ${attempts} failed to publish message to ${queueName}:`, error);
        
        if (attempts >= this.retryAttempts) {
          logger.error(`Failed to publish message after ${this.retryAttempts} attempts:`, error);
          throw error;
        }
        
        await this.delay(this.retryDelay * attempts);
      }
    }
  }

  async publishAutoMessage(autoMessageData) {
    try {
      const queueName = process.env.MESSAGE_SENDING_QUEUE || 'message_sending_queue';
      
      const message = {
        id: autoMessageData._id || autoMessageData.id,
        type: 'auto_message',
        payload: {
          autoMessageId: autoMessageData._id || autoMessageData.id,
          senderId: autoMessageData.sender,
          receiverId: autoMessageData.receiver,
          content: autoMessageData.content,
          sendDate: autoMessageData.sendDate,
          metadata: autoMessageData.metadata
        },
        timestamp: Date.now(),
        retryCount: 0
      };

      await this.publishToQueue(queueName, message, {
        headers: {
          'message-type': 'auto_message',
          'sender-id': autoMessageData.sender,
          'receiver-id': autoMessageData.receiver
        }
      });

      logger.info(`Auto message queued for processing:`, {
        autoMessageId: message.id,
        senderId: autoMessageData.sender,
        receiverId: autoMessageData.receiver
      });

      return true;
    } catch (error) {
      logger.error('Error publishing auto message:', error);
      throw error;
    }
  }

  async publishRealtimeMessage(messageData) {
    try {
      const exchangeName = 'realtime_messages';
      const routingKey = `message.${messageData.conversationId}`;
      
      const message = {
        id: messageData._id || messageData.id,
        type: 'realtime_message',
        payload: messageData,
        timestamp: Date.now()
      };

      const channel = this.getPublisherChannel();
      const messageBuffer = Buffer.from(JSON.stringify(message));
      
      const result = channel.publish(exchangeName, routingKey, messageBuffer, {
        persistent: false, 
        timestamp: Date.now(),
        messageId: message.id
      });

      if (result) {
        logger.debug(`Real-time message published:`, {
          messageId: message.id,
          conversationId: messageData.conversationId,
          routingKey
        });
        return true;
      } else {
        throw new Error('Failed to publish real-time message');
      }
    } catch (error) {
      logger.error('Error publishing real-time message:', error);
      throw error;
    }
  }

  async publishNotification(notificationData) {
    try {
      const exchangeName = 'notifications';
      
      const message = {
        id: `notification-${Date.now()}-${Math.random()}`,
        type: 'notification',
        payload: notificationData,
        timestamp: Date.now()
      };

      const channel = this.getPublisherChannel();
      const messageBuffer = Buffer.from(JSON.stringify(message));
      
      const result = channel.publish(exchangeName, '', messageBuffer, {
        persistent: false,
        timestamp: Date.now(),
        messageId: message.id
      });

      if (result) {
        logger.debug(`Notification published:`, {
          messageId: message.id,
          type: notificationData.type
        });
        return true;
      } else {
        throw new Error('Failed to publish notification');
      }
    } catch (error) {
      logger.error('Error publishing notification:', error);
      throw error;
    }
  }

  async publishBatch(queueName, messages, options = {}) {
    try {
      const channel = this.getPublisherChannel();
      
      const promises = messages.map(message => {
        const messageBuffer = Buffer.from(JSON.stringify(message));
        const publishOptions = {
          persistent: true,
          timestamp: Date.now(),
          messageId: message.id || `${Date.now()}-${Math.random()}`,
          ...options
        };
        
        return channel.sendToQueue(queueName, messageBuffer, publishOptions);
      });

      const results = await Promise.all(promises);
      const successCount = results.filter(result => result).length;
      
      logger.info(`Batch publish completed: ${successCount}/${messages.length} messages published to ${queueName}`);
      
      return {
        total: messages.length,
        successful: successCount,
        failed: messages.length - successCount
      };
    } catch (error) {
      logger.error('Error in batch publish:', error);
      throw error;
    }
  }

  async getQueueMessageCount(queueName) {
    try {
      const stats = await rabbitMQConnection.getQueueStats(queueName);
      return stats ? stats.messageCount : 0;
    } catch (error) {
      logger.error('Error getting queue message count:', error);
      return 0;
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  
  async healthCheck() {
    try {
      const isHealthy = rabbitMQConnection.isHealthy();
      const queueName = process.env.MESSAGE_SENDING_QUEUE || 'message_sending_queue';
      const messageCount = await this.getQueueMessageCount(queueName);
      
      return {
        isHealthy,
        messageCount,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Producer health check failed:', error);
      return {
        isHealthy: false,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }
}

module.exports = new MessageProducer();