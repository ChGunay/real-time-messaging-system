require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');

const connectDatabase = require('./config/database');
const redisConnection = require('./config/redis');
const rabbitMQConnection = require('./config/rabbitmq');
const elasticsearchConnection = require('./config/elasticsearch');
const logger = require('./utils/logger');
const { expressCorsConfig, socketCorsConfig } = require('./config/cors');

const { specs, swaggerUi, swaggerConfig } = require('./config/swagger');

const {
  securityMiddleware,
  additionalSecurityHeaders,
  securityLogger,
  httpsRedirect,
  validateRequest,
  requestSizeLimiter
} = require('./middleware/security');
const { rateLimiters, rateLimitLogger } = require('./middleware/rateLimiter');
const { globalErrorHandler, handleUndefinedRoutes, handleRequestTimeout } = require('./middleware/errorHandler');
const { systemMonitor, monitoringMiddleware } = require('./utils/monitoring');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: socketCorsConfig
});

app.set('trust proxy', 1);

async function initializeConnections() {
  try {
    await connectDatabase();
    await redisConnection.connect();
    await rabbitMQConnection.connect();
    await elasticsearchConnection.connect();
    logger.info('All connections initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize connections:', error);
    process.exit(1);
  }
}

initializeConnections();

systemMonitor.start();

app.use(httpsRedirect);
app.use(additionalSecurityHeaders);
app.use(requestSizeLimiter);
app.use(handleRequestTimeout());

app.use(securityLogger);
app.use(monitoringMiddleware);
app.use(rateLimitLogger);

app.use(rateLimiters.global);

app.use(compression());
app.use(cors(expressCorsConfig));

app.use(...securityMiddleware);
app.use(validateRequest);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Basic health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: OK
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   description: Server uptime in seconds
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

const initializeSocket = require('./services/socket');
let socketHandler = null;

setTimeout(async () => {
  try {
    socketHandler = initializeSocket(io);
    module.exports.socketHandler = socketHandler;

    const { messageSearchService } = require('./services/elasticsearch');
    await messageSearchService.initialize();
    logger.info('Elasticsearch search service initialized');

    const jobManager = require('./jobs/jobManager');
    await jobManager.init();
    logger.info('Job manager initialized successfully');

  } catch (error) {
    logger.error('Error initializing Socket.IO and Job Manager:', error);
  }
}, 3000);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, swaggerConfig));

app.get('/docs', (req, res) => {
  res.redirect('/api-docs');
});

const apiRoutes = require('./routes');
app.use('/api', apiRoutes);

app.get('/metrics', (req, res) => {
  res.json({
    success: true,
    data: systemMonitor.getMetrics()
  });
});

app.get('/health/detailed', (req, res) => {
  const report = systemMonitor.generateHealthReport();
  const status = report.status === 'healthy' ? 200 : report.status === 'warning' ? 200 : 503;

  res.status(status).json({
    success: report.status !== 'critical',
    data: report
  });
});

app.use('*', handleUndefinedRoutes);

app.use(globalErrorHandler);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  logger.info(`🚀 Server is running on port ${PORT}`);
  logger.info('🔒 Security features enabled');
  logger.info('📊 System monitoring active');
  logger.info('🛡️ Rate limiting configured');

  logger.info('System Information:', {
    nodeVersion: process.version,
    platform: process.platform,
    environment: process.env.NODE_ENV || 'development',
    memoryUsage: systemMonitor.getCurrentMemoryUsage()
  });
});

const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    server.close(() => {
      logger.info('HTTP server closed');
    });

    systemMonitor.stop();

    const jobManager = require('./jobs/jobManager');
    await jobManager.destroy();

    await redisConnection.disconnect();
    await rabbitMQConnection.disconnect();
    await elasticsearchConnection.disconnect();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

module.exports = { app, server, io };