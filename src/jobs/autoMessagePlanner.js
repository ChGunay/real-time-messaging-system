const cron = require('node-cron');
const { User, AutoMessage } = require('../models');
const { getRandomMessage, shuffleArray } = require('../utils/messageTemplates');
const logger = require('../utils/logger');

class AutoMessagePlanner {
  constructor() {
    this.isRunning = false;
    this.cronJob = null;
    this.lastRun = null;
    this.stats = {
      totalRuns: 0,
      totalMessagesGenerated: 0,
      totalPairsCreated: 0,
      lastRunStats: null
    };
  }

  init() {
    try {
      const cronPattern = process.env.AUTO_MESSAGE_CRON || '0 2 * * *';
      
      this.cronJob = cron.schedule(cronPattern, async () => {
        await this.runAutoMessageGeneration();
      }, {
        scheduled: false, 
        timezone: 'Europe/Istanbul' 
      });

      logger.info(`Auto message planner initialized with pattern: ${cronPattern}`);
      
      this.start();
      
    } catch (error) {
      logger.error('Error initializing auto message planner:', error);
      throw error;
    }
  }

  start() {
    if (this.cronJob && !this.isRunning) {
      this.cronJob.start();
      this.isRunning = true;
      logger.info('Auto message planner started');
    }
  }

  stop() {
    if (this.cronJob && this.isRunning) {
      this.cronJob.stop();
      this.isRunning = false;
      logger.info('Auto message planner stopped');
    }
  }

  async runAutoMessageGeneration() {
    const startTime = Date.now();
    const generationRound = new Date();
    
    logger.info('Starting auto message generation...');

    try {
      const activeUsers = await User.find({
        isActive: true
      }).select('_id username email').lean();

      if (activeUsers.length < 2) {
        logger.warn('Not enough active users for auto message generation');
        return;
      }

      const shuffledUsers = shuffleArray(activeUsers);
      
      const pairs = this.createUserPairs(shuffledUsers);
      
      if (pairs.length === 0) {
        logger.warn('No user pairs could be created');
        return;
      }

      const autoMessages = [];
      const messageTemplates = [];

      for (let i = 0; i < pairs.length; i++) {
        const [sender, receiver] = pairs[i];
        
        const messageContent = getRandomMessage();
        
        const minDelay = 1 * 60 * 60 * 1000; // 1 hour
        const maxDelay = 24 * 60 * 60 * 1000; // 24 hours
        const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
        const sendDate = new Date(Date.now() + randomDelay);

        const autoMessage = {
          sender: sender._id,
          receiver: receiver._id,
          content: messageContent,
          sendDate: sendDate,
          metadata: {
            generationRound: generationRound,
            messageTemplate: messageContent,
            pairIndex: i
          }
        };

        autoMessages.push(autoMessage);
        messageTemplates.push(messageContent);

        logger.debug(`Generated auto message: ${sender.username} -> ${receiver.username} at ${sendDate.toISOString()}`);
      }

      const insertedMessages = await AutoMessage.insertMany(autoMessages);

      const runStats = {
        totalUsers: activeUsers.length,
        totalPairs: pairs.length,
        messagesGenerated: insertedMessages.length,
        generationRound: generationRound,
        executionTime: Date.now() - startTime,
        uniqueTemplates: [...new Set(messageTemplates)].length
      };

      this.updateStats(runStats);
      this.lastRun = generationRound;

      logger.info('Auto message generation completed successfully:', runStats);

      await this.cleanupOldMessages();

    } catch (error) {
      logger.error('Error in auto message generation:', error);
      
      this.stats.lastRunStats = {
        success: false,
        error: error.message,
        timestamp: generationRound,
        executionTime: Date.now() - startTime
      };
    }
  }

  createUserPairs(users) {
    const pairs = [];
    
    
    for (let i = 0; i < users.length - 1; i += 2) {
      const user1 = users[i];
      const user2 = users[i + 1];
      
      
      pairs.push([user1, user2]);
      pairs.push([user2, user1]);
    }

    logger.debug(`Created ${pairs.length} message pairs from ${users.length} users`);
    return pairs;
  }

  
  updateStats(runStats) {
    this.stats.totalRuns++;
    this.stats.totalMessagesGenerated += runStats.messagesGenerated;
    this.stats.totalPairsCreated += runStats.totalPairs;
    this.stats.lastRunStats = {
      ...runStats,
      success: true,
      timestamp: runStats.generationRound
    };
  }

  
  async cleanupOldMessages() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await AutoMessage.deleteMany({
        createdAt: { $lt: thirtyDaysAgo },
        isSent: true 
      });

      if (result.deletedCount > 0) {
        logger.info(`Cleaned up ${result.deletedCount} old auto messages`);
      }
    } catch (error) {
      logger.error('Error cleaning up old messages:', error);
    }
  }

  
  async runManually() {
    if (this.isRunning) {
      logger.info('Manual auto message generation triggered');
      await this.runAutoMessageGeneration();
    } else {
      logger.warn('Auto message planner is not running');
    }
  }

  
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      cronPattern: process.env.AUTO_MESSAGE_CRON || '0 2 * * *',
      nextRun: this.cronJob ? this.cronJob.nextDates().toString() : null
    };
  }

  
  async getPendingMessagesCount() {
    try {
      const count = await AutoMessage.countDocuments({
        isSent: false,
        isQueued: false,
        retryCount: { $lt: 3 }
      });
      return count;
    } catch (error) {
      logger.error('Error getting pending messages count:', error);
      return 0;
    }
  }

  
  async getGenerationRoundStats(roundDate) {
    try {
      const stats = await AutoMessage.getGenerationStats(roundDate);
      return stats.length > 0 ? stats[0] : null;
    } catch (error) {
      logger.error('Error getting generation round stats:', error);
      return null;
    }
  }

  
  async getGenerationRounds(limit = 10) {
    try {
      const rounds = await AutoMessage.aggregate([
        {
          $group: {
            _id: '$metadata.generationRound',
            count: { $sum: 1 },
            sent: { $sum: { $cond: ['$isSent', 1, 0] } },
            queued: { $sum: { $cond: ['$isQueued', 1, 0] } },
            failed: { $sum: { $cond: [{ $gte: ['$retryCount', 3] }, 1, 0] } }
          }
        },
        { $sort: { _id: -1 } },
        { $limit: limit }
      ]);

      return rounds;
    } catch (error) {
      logger.error('Error getting generation rounds:', error);
      return [];
    }
  }

  
  destroy() {
    this.stop();
    this.cronJob = null;
    logger.info('Auto message planner destroyed');
  }
}

module.exports = AutoMessagePlanner;