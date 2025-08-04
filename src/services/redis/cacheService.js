const redisConnection = require('../../config/redis');
const logger = require('../../utils/logger');

class CacheService {
  constructor() {
    this.DEFAULT_TTL = 3600; 
    this.CONVERSATION_TTL = 1800; 
    this.USER_TTL = 900; 
    this.SESSION_TTL = 86400; 
  }

  getClient() {
    return redisConnection.getClient();
  }

  async set(key, value, ttl = this.DEFAULT_TTL) {
    try {
      const client = this.getClient();
      const serializedValue = JSON.stringify(value);
      
      if (ttl > 0) {
        await client.setEx(key, ttl, serializedValue);
      } else {
        await client.set(key, serializedValue);
      }
      
      logger.debug(`Cache set: ${key}`);
      return true;
    } catch (error) {
      logger.error('Cache set error:', error);
      return false;
    }
  }

  async get(key) {
    try {
      const client = this.getClient();
      const value = await client.get(key);
      
      if (value === null) {
        return null;
      }
      
      logger.debug(`Cache hit: ${key}`);
      return JSON.parse(value);
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  }

  async del(key) {
    try {
      const client = this.getClient();
      const result = await client.del(key);
      logger.debug(`Cache deleted: ${key}`);
      return result > 0;
    } catch (error) {
      logger.error('Cache delete error:', error);
      return false;
    }
  }

  async exists(key) {
    try {
      const client = this.getClient();
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Cache exists error:', error);
      return false;
    }
  }

  async expire(key, ttl) {
    try {
      const client = this.getClient();
      const result = await client.expire(key, ttl);
      return result === 1;
    } catch (error) {
      logger.error('Cache expire error:', error);
      return false;
    }
  }

  async cacheUser(userId, userData) {
    const key = `user:${userId}`;
    return await this.set(key, userData, this.USER_TTL);
  }

  async getCachedUser(userId) {
    const key = `user:${userId}`;
    return await this.get(key);
  }

  async invalidateUser(userId) {
    const key = `user:${userId}`;
    return await this.del(key);
  }

  async cacheConversation(conversationId, conversationData) {
    const key = `conversation:${conversationId}`;
    return await this.set(key, conversationData, this.CONVERSATION_TTL);
  }

  async getCachedConversation(conversationId) {
    const key = `conversation:${conversationId}`;
    return await this.get(key);
  }

  async invalidateConversation(conversationId) {
    const key = `conversation:${conversationId}`;
    return await this.del(key);
  }

  async cacheConversationMessages(conversationId, page, messages) {
    const key = `messages:${conversationId}:page:${page}`;
    return await this.set(key, messages, this.CONVERSATION_TTL);
  }

  async getCachedConversationMessages(conversationId, page) {
    const key = `messages:${conversationId}:page:${page}`;
    return await this.get(key);
  }

  async invalidateConversationMessages(conversationId) {
    try {
      const client = this.getClient();
      const pattern = `messages:${conversationId}:*`;
      const keys = await client.keys(pattern);
      
      if (keys.length > 0) {
        await client.del(keys);
        logger.debug(`Invalidated ${keys.length} message cache entries for conversation ${conversationId}`);
      }
      
      return true;
    } catch (error) {
      logger.error('Error invalidating conversation messages cache:', error);
      return false;
    }
  }

  async invalidateUserConversations(userId) {
    try {
      const client = this.getClient();
      const pattern = `user_conversations:${userId}:*`;
      const keys = await client.keys(pattern);
      
      if (keys.length > 0) {
        await client.del(keys);
        logger.debug(`Invalidated ${keys.length} user conversation cache entries for user ${userId}`);
      }
      
      return true;
    } catch (error) {
      logger.error('Error invalidating user conversations cache:', error);
      return false;
    }
  }

  async blacklistToken(token, ttl = this.SESSION_TTL) {
    const key = `blacklisted_token:${token}`;
    return await this.set(key, { blacklisted: true }, ttl);
  }

  async isTokenBlacklisted(token) {
    const key = `blacklisted_token:${token}`;
    return await this.exists(key);
  }

  async getCacheStats() {
    try {
      const client = this.getClient();
      
      const info = await client.info('memory');
      const keyspace = await client.info('keyspace');
      
      return {
        memory: info,
        keyspace: keyspace,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Error getting cache stats:', error);
      return null;
    }
  }

}

module.exports = new CacheService();