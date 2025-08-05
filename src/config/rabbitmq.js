const amqp = require('amqplib');
const logger = require('../utils/logger');

class RabbitMQConnection {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.consumerChannel = null;
    this.publisherChannel = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000;
  }

  async connect() {
    try {
      const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

      this.connection = await amqp.connect(url);
      this.isConnected = true;
      this.reconnectAttempts = 0;

      logger.info('RabbitMQ connection established');

      this.channel = await this.connection.createChannel();
      this.consumerChannel = await this.connection.createChannel();
      this.publisherChannel = await this.connection.createChannel();

      await this.consumerChannel.prefetch(1);

      this.connection.on('error', (err) => {
        logger.error('RabbitMQ connection error:', err);
        this.isConnected = false;
      });

      this.connection.on('close', () => {
        logger.warn('RabbitMQ connection closed');
        this.isConnected = false;
        this.handleReconnect();
      });

      this.channel.on('error', (err) => {
        logger.error('RabbitMQ channel error:', err);
      });

      this.channel.on('close', () => {
        logger.warn('RabbitMQ channel closed');
      });

      await this.setupQueuesAndExchanges();

      logger.info('RabbitMQ setup completed successfully');

      return true;
    } catch (error) {
      logger.error('RabbitMQ connection failed:', error);
      this.isConnected = false;
      await this.handleReconnect();
      throw error;
    }
  }

  async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max RabbitMQ reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    logger.info(
      `Attempting to reconnect to RabbitMQ (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error('RabbitMQ reconnection failed:', error);
      }
    }, this.reconnectDelay);
  }

  async setupQueuesAndExchanges() {
    try {
      const messageSendingQueue =
        process.env.MESSAGE_SENDING_QUEUE || 'message_sending_queue';

      await this.channel.assertQueue(messageSendingQueue, {
        durable: true,
        arguments: {
          'x-message-ttl': 3600000,
          'x-max-retries': 3
        }
      });

      const deadLetterQueue = 'failed_messages_dlq';
      await this.channel.assertQueue(deadLetterQueue, {
        durable: true
      });

      const realtimeExchange = 'realtime_messages';
      await this.channel.assertExchange(realtimeExchange, 'topic', {
        durable: true
      });

      const notificationExchange = 'notifications';
      await this.channel.assertExchange(notificationExchange, 'fanout', {
        durable: true
      });

      logger.info('RabbitMQ queues and exchanges setup completed');
    } catch (error) {
      logger.error('Error setting up queues and exchanges:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      if (this.consumerChannel) {
        await this.consumerChannel.close();
        this.consumerChannel = null;
      }

      if (this.publisherChannel) {
        await this.publisherChannel.close();
        this.publisherChannel = null;
      }

      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }

      this.isConnected = false;
      logger.info('RabbitMQ connection closed');
    } catch (error) {
      logger.error('Error closing RabbitMQ connection:', error);
    }
  }

  getChannel() {
    if (!this.isConnected || !this.channel) {
      throw new Error('RabbitMQ not connected or channel not available');
    }
    return this.channel;
  }

  getConsumerChannel() {
    if (!this.isConnected || !this.consumerChannel) {
      throw new Error(
        'RabbitMQ not connected or consumer channel not available'
      );
    }
    return this.consumerChannel;
  }

  getPublisherChannel() {
    if (!this.isConnected || !this.publisherChannel) {
      throw new Error(
        'RabbitMQ not connected or publisher channel not available'
      );
    }
    return this.publisherChannel;
  }

  isHealthy() {
    return (
      this.isConnected &&
      this.connection &&
      !this.connection.connection.stream.destroyed
    );
  }

  async getQueueStats(queueName) {
    try {
      if (!this.isConnected) {
        throw new Error('RabbitMQ not connected');
      }

      const queueInfo = await this.channel.checkQueue(queueName);
      return {
        queue: queueName,
        messageCount: queueInfo.messageCount,
        consumerCount: queueInfo.consumerCount
      };
    } catch (error) {
      logger.error('Error getting queue stats:', error);
      return null;
    }
  }
}

const rabbitMQConnection = new RabbitMQConnection();

process.on('SIGINT', async () => {
  await rabbitMQConnection.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await rabbitMQConnection.disconnect();
  process.exit(0);
});

module.exports = rabbitMQConnection;
