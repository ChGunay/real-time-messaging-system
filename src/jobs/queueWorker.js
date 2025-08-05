const cron = require('node-cron');
const { AutoMessage } = require('../models');
const { messageProducer } = require('../services/rabbitmq');
const logger = require('../utils/logger');

class QueueWorker {
  constructor() {
    this.isRunning = false;
    this.cronJob = null;
    this.stats = {
      totalRuns: 0,
      totalMessagesQueued: 0,
      totalProcessingTime: 0,
      lastRunStats: null,
      errors: 0
    };
    this.batchSize = 50;
  }

  init() {
    try {
      const cronPattern = process.env.QUEUE_WORKER_CRON || '* * * * *';

      this.cronJob = cron.schedule(
        cronPattern,
        async () => {
          await this.processReadyMessages();
        },
        {
          scheduled: false,
          timezone: 'Europe/Istanbul'
        }
      );

      logger.info(`Queue worker initialized with pattern: ${cronPattern}`);

      this.start();
    } catch (error) {
      logger.error('Error initializing queue worker:', error);
      throw error;
    }
  }

  start() {
    if (this.cronJob && !this.isRunning) {
      this.cronJob.start();
      this.isRunning = true;
      logger.info('Queue worker started');
    }
  }

  stop() {
    if (this.cronJob && this.isRunning) {
      this.cronJob.stop();
      this.isRunning = false;
      logger.info('Queue worker stopped');
    }
  }

  async processReadyMessages() {
    const startTime = Date.now();

    try {
      const readyMessages = await AutoMessage.findReadyForQueue().limit(
        this.batchSize
      );

      if (readyMessages.length === 0) {
        logger.debug('No messages ready for queueing');
        return;
      }

      logger.info(`Processing ${readyMessages.length} ready messages`);

      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      for (const autoMessage of readyMessages) {
        try {
          await this.queueMessage(autoMessage);
          successCount++;
        } catch (error) {
          errorCount++;
          errors.push({
            messageId: autoMessage._id,
            error: error.message
          });

          await this.handleMessageError(autoMessage, error.message);
        }
      }

      const runStats = {
        timestamp: new Date(),
        messagesProcessed: readyMessages.length,
        successCount,
        errorCount,
        errors,
        executionTime: Date.now() - startTime
      };

      this.updateStats(runStats);

      if (successCount > 0) {
        logger.info(
          `Queue worker completed: ${successCount} messages queued successfully, ${errorCount} errors`
        );
      }

      if (errorCount > 0) {
        logger.warn('Queue worker errors:', errors);
      }
    } catch (error) {
      logger.error('Error in queue worker:', error);
      this.stats.errors++;
      this.stats.lastRunStats = {
        success: false,
        error: error.message,
        timestamp: new Date(),
        executionTime: Date.now() - startTime
      };
    }
  }

  async queueMessage(autoMessage) {
    try {
      if (
        !autoMessage.sender ||
        !autoMessage.receiver ||
        !autoMessage.content
      ) {
        throw new Error(
          'Invalid message data: missing sender, receiver, or content'
        );
      }

      if (!autoMessage.sender.isActive || !autoMessage.receiver.isActive) {
        throw new Error('Sender or receiver is not active');
      }

      const messageData = {
        autoMessageId: autoMessage._id,
        sender: autoMessage.sender._id,
        receiver: autoMessage.receiver._id,
        content: autoMessage.content,
        sendDate: autoMessage.sendDate,
        metadata: autoMessage.metadata
      };

      await messageProducer.publishAutoMessage(messageData);

      await autoMessage.markAsQueued();

      logger.debug(
        `Message queued: ${autoMessage._id} from ${autoMessage.sender.username} to ${autoMessage.receiver.username}`
      );
    } catch (error) {
      logger.error(`Error queueing message ${autoMessage._id}:`, error);
      throw error;
    }
  }

  async handleMessageError(autoMessage, errorMessage) {
    try {
      await autoMessage.handleRetry(errorMessage);

      if (!autoMessage.canRetry()) {
        logger.error(
          `Message ${autoMessage._id} failed permanently after ${autoMessage.retryCount} attempts`
        );
      }
    } catch (updateError) {
      logger.error(
        `Error updating message ${autoMessage._id} with error:`,
        updateError
      );
    }
  }

  updateStats(runStats) {
    this.stats.totalRuns++;
    this.stats.totalMessagesQueued += runStats.successCount;
    this.stats.totalProcessingTime += runStats.executionTime;
    this.stats.errors += runStats.errorCount;
    this.stats.lastRunStats = {
      ...runStats,
      success: runStats.errorCount === 0
    };
  }

  async runManually() {
    if (this.isRunning) {
      logger.info('Manual queue worker triggered');
      await this.processReadyMessages();
    } else {
      logger.warn('Queue worker is not running');
    }
  }

  async getReadyMessagesCount() {
    try {
      const count = await AutoMessage.countDocuments({
        sendDate: { $lte: new Date() },
        isQueued: false,
        isSent: false,
        retryCount: { $lt: 3 }
      });
      return count;
    } catch (error) {
      logger.error('Error getting ready messages count:', error);
      return 0;
    }
  }

  async getQueuedMessagesCount() {
    try {
      const count = await AutoMessage.countDocuments({
        isQueued: true,
        isSent: false
      });
      return count;
    } catch (error) {
      logger.error('Error getting queued messages count:', error);
      return 0;
    }
  }

  async getFailedMessagesCount() {
    try {
      const count = await AutoMessage.countDocuments({
        retryCount: { $gte: 3 },
        isSent: false
      });
      return count;
    } catch (error) {
      logger.error('Error getting failed messages count:', error);
      return 0;
    }
  }

  getNextRunTime() {
    if (!this.cronJob) {
      return null;
    }

    try {
      const cronParser = require('cron-parser');
      const interval = cronParser.parseExpression(
        process.env.QUEUE_WORKER_CRON || '* * * * *'
      );
      return interval.next().toString();
    } catch (error) {
      logger.warn('Unable to calculate next run time:', error);
      return 'Unknown';
    }
  }

  async getDetailedStats() {
    try {
      const [readyCount, queuedCount, failedCount, rabbitMQHealth] =
        await Promise.all([
          this.getReadyMessagesCount(),
          this.getQueuedMessagesCount(),
          this.getFailedMessagesCount(),
          messageProducer.healthCheck()
        ]);

      return {
        ...this.stats,
        isRunning: this.isRunning,
        cronPattern: process.env.QUEUE_WORKER_CRON || '* * * * *',
        nextRun: this.getNextRunTime(),
        messageQueues: {
          ready: readyCount,
          queued: queuedCount,
          failed: failedCount
        },
        rabbitMQHealth,
        batchSize: this.batchSize,
        averageProcessingTime:
          this.stats.totalRuns > 0
            ? Math.round(this.stats.totalProcessingTime / this.stats.totalRuns)
            : 0
      };
    } catch (error) {
      logger.error('Error getting detailed stats:', error);
      return {
        ...this.stats,
        error: error.message
      };
    }
  }

  async getProcessingHistory(_limit = 10) {
    try {
      return {
        lastRunStats: this.stats.lastRunStats,
        totalRuns: this.stats.totalRuns,
        totalMessagesQueued: this.stats.totalMessagesQueued,
        errorRate:
          this.stats.totalRuns > 0
            ? ((this.stats.errors / this.stats.totalRuns) * 100).toFixed(2) +
              '%'
            : '0%'
      };
    } catch (error) {
      logger.error('Error getting processing history:', error);
      return null;
    }
  }

  async retryFailedMessages(limit = 10) {
    try {
      const failedMessages = await AutoMessage.find({
        retryCount: { $gte: 3 },
        isSent: false
      })
        .populate('sender receiver', 'username email isActive')
        .limit(limit);

      let retriedCount = 0;

      for (const message of failedMessages) {
        message.retryCount = 0;
        message.errorMessage = '';
        message.isQueued = false;

        await message.save();
        retriedCount++;
      }

      logger.info(`Manually retried ${retriedCount} failed messages`);
      return retriedCount;
    } catch (error) {
      logger.error('Error retrying failed messages:', error);
      throw error;
    }
  }

  setBatchSize(newSize) {
    if (newSize > 0 && newSize <= 200) {
      this.batchSize = newSize;
      logger.info(`Queue worker batch size updated to: ${newSize}`);
    } else {
      logger.warn('Invalid batch size. Must be between 1 and 200');
    }
  }

  destroy() {
    this.stop();
    this.cronJob = null;
    logger.info('Queue worker destroyed');
  }
}

module.exports = QueueWorker;
