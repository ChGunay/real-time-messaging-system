const redis = require("redis");
const logger = require("../utils/logger");

class RedisConnection {
  constructor() {
    this.client = null;
    this.subscriber = null;
    this.publisher = null;
  }

  getRedisConfig() {
    return {
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    };
  }

  async connect() {
    try {
      const config = this.getRedisConfig();

      this.client = redis.createClient(config);
      this.subscriber = redis.createClient(config);
      this.publisher = redis.createClient(config);

      this.client.on("connect", () => {
        logger.info("Redis client connected");
      });

      this.client.on("ready", () => {
        logger.info("Redis client ready");
      });

      this.client.on("error", (err) => {
        logger.error("Redis client error:", err);
      });

      this.client.on("end", () => {
        logger.warn("Redis client connection ended");
      });

      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect(),
      ]);

      logger.info("All Redis clients connected successfully");

      process.on("SIGINT", async () => {
        await this.disconnect();
        process.exit(0);
      });
    } catch (error) {
      logger.error("Redis connection failed:", error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.client) await this.client.quit();
      if (this.subscriber) await this.subscriber.quit();
      if (this.publisher) await this.publisher.quit();

      logger.info("Redis clients disconnected");
    } catch (error) {
      logger.error("Error disconnecting Redis clients:", error);
    }
  }

  getClient() {
    if (!this.client) {
      throw new Error("Redis client not connected");
    }
    return this.client;
  }

  getSubscriber() {
    if (!this.subscriber) {
      throw new Error("Redis subscriber not connected");
    }
    return this.subscriber;
  }

  getPublisher() {
    if (!this.publisher) {
      throw new Error("Redis publisher not connected");
    }
    return this.publisher;
  }

  async ping() {
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch (error) {
      logger.error("Redis ping failed:", error);
      return false;
    }
  }

  async flushDatabase() {
    if (process.env.NODE_ENV === "development") {
      await this.client.flushDb();
      logger.info("Redis database flushed (development mode)");
    }
  }
}

const redisConnection = new RedisConnection();

module.exports = redisConnection;
