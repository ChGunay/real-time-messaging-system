const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticate } = require('../middleware/auth');
const { validateQuery, validateParams, paginationSchema } = require('../middleware/validation');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');

/**
 * @swagger
 * components:
 *   schemas:
 *     SystemStatus:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [healthy, warning, critical]
 *         uptime:
 *           type: number
 *           description: Server uptime in seconds
 *         memory:
 *           type: object
 *           properties:
 *             usage:
 *               type: string
 *             heapUsed:
 *               type: string
 *             heapTotal:
 *               type: string
 *         database:
 *           type: object
 *           properties:
 *             mongodb:
 *               type: string
 *               enum: [connected, disconnected]
 *             redis:
 *               type: string
 *               enum: [connected, disconnected]
 *             rabbitmq:
 *               type: string
 *               enum: [connected, disconnected]
 *         jobs:
 *           type: object
 *           properties:
 *             planner:
 *               type: string
 *               enum: [running, stopped]
 *             worker:
 *               type: string
 *               enum: [running, stopped]
 *             consumer:
 *               type: string
 *               enum: [running, stopped]
 *       
 *     JobStatus:
 *       type: object
 *       properties:
 *         planner:
 *           type: object
 *           properties:
 *             status:
 *               type: string
 *               enum: [running, stopped]
 *             nextRun:
 *               type: string
 *               format: date-time
 *             lastRun:
 *               type: string
 *               format: date-time
 *         worker:
 *           type: object
 *           properties:
 *             status:
 *               type: string
 *               enum: [running, stopped]
 *             lastRun:
 *               type: string
 *               format: date-time
 *         consumer:
 *           type: object
 *           properties:
 *             status:
 *               type: string
 *               enum: [running, stopped]
 *             messagesProcessed:
 *               type: number
 *       
 *     AutoMessageStats:
 *       type: object
 *       properties:
 *         autoMessages:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AutoMessage'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMeta'
 *       
 *     MessageTemplate:
 *       type: object
 *       properties:
 *         category:
 *           type: string
 *           description: Template category
 *         templates:
 *           type: array
 *           items:
 *             type: string
 *           description: Message templates in this category
 *       example:
 *         category: greeting
 *         templates:
 *           - "Merhaba! Nasılsın?"
 *           - "Selam! Ne haber?"
 */

const router = express.Router();

// Rate limiting for admin endpoints (more restrictive)
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  message: {
    success: false,
    message: 'Too many admin requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});
const controlLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // limit each IP to 10 control operations per 5 minutes
  message: {
    success: false,
    message: 'Too many control operations, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const autoMessagesQuerySchema = paginationSchema.keys({
  status: Joi.string().valid('pending', 'queued', 'sent', 'failed').optional(),
  generationRound: Joi.date().iso().optional(),
  senderId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  receiverId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional()
});

const jobControlParamsSchema = Joi.object({
  job: Joi.string().valid('planner', 'worker', 'consumer').required(),
  action: Joi.string().valid('start', 'stop').required()
});

router.use(authenticate);
router.use(adminLimiter);

/**
 * @swagger
 * /api/admin/status:
 *   get:
 *     summary: Get system status overview
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: System status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/SystemStatus'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get('/status', adminController.getSystemStatus);

/**
 * @swagger
 * /api/admin/health:
 *   get:
 *     summary: Detailed health check
 *     tags: [Health]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Health check completed
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           enum: [healthy, warning, critical]
 *                         checks:
 *                           type: object
 *                         timestamp:
 *                           type: string
 *                           format: date-time
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get('/health', adminController.healthCheck);

/**
 * @swagger
 * /api/admin/jobs/status:
 *   get:
 *     summary: Get job status information
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Job status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/JobStatus'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get('/jobs/status', adminController.getJobStatus);

/**
 * @swagger
 * /api/admin/jobs/statistics:
 *   get:
 *     summary: Get job statistics
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Job statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         totalJobs:
 *                           type: number
 *                         activeJobs:
 *                           type: number
 *                         completedJobs:
 *                           type: number
 *                         failedJobs:
 *                           type: number
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get('/jobs/statistics', adminController.getJobStatistics);

/**
 * @swagger
 * /api/admin/jobs/trigger/planner:
 *   post:
 *     summary: Manually trigger auto message planner
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Planner triggered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post('/jobs/trigger/planner', 
  controlLimiter,
  adminController.triggerAutoMessagePlanner
);

/**
 * @swagger
 * /api/admin/jobs/trigger/worker:
 *   post:
 *     summary: Manually trigger queue worker
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Worker triggered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post('/jobs/trigger/worker', 
  controlLimiter,
  adminController.triggerQueueWorker
);

/**
 * @swagger
 * /api/admin/jobs/control/{job}/{action}:
 *   post:
 *     summary: Control job (start/stop)
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: job
 *         in: path
 *         required: true
 *         description: Job type
 *         schema:
 *           type: string
 *           enum: [planner, worker, consumer]
 *           example: planner
 *       - name: action
 *         in: path
 *         required: true
 *         description: Action to perform
 *         schema:
 *           type: string
 *           enum: [start, stop]
 *           example: start
 *     responses:
 *       200:
 *         description: Job control action completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post('/jobs/control/:job/:action',
  controlLimiter,
  validateParams(jobControlParamsSchema),
  adminController.controlJob
);

/**
 * @swagger
 * /api/admin/jobs/restart:
 *   post:
 *     summary: Restart all jobs
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All jobs restarted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post('/jobs/restart',
  controlLimiter,
  adminController.restartJobs
);

/**
 * @swagger
 * /api/admin/maintenance:
 *   post:
 *     summary: Run system maintenance
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Maintenance completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post('/maintenance',
  controlLimiter,
  adminController.runMaintenance
);

/**
 * @swagger
 * /api/admin/messages/auto:
 *   get:
 *     summary: Get auto messages with filtering
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - name: status
 *         in: query
 *         description: Filter by message status
 *         schema:
 *           type: string
 *           enum: [pending, queued, sent, failed]
 *       - name: generationRound
 *         in: query
 *         description: Filter by generation round date
 *         schema:
 *           type: string
 *           format: date
 *       - name: senderId
 *         in: query
 *         description: Filter by sender ID
 *         schema:
 *           type: string
 *           format: objectId
 *       - name: receiverId
 *         in: query
 *         description: Filter by receiver ID
 *         schema:
 *           type: string
 *           format: objectId
 *     responses:
 *       200:
 *         description: Auto messages retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/AutoMessageStats'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get('/messages/auto',
  validateQuery(autoMessagesQuerySchema),
  adminController.getAutoMessages
);

/**
 * @swagger
 * /api/admin/templates:
 *   get:
 *     summary: Get message templates
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Message templates retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/MessageTemplate'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get('/templates',
  adminController.getMessageTemplates
);

/**
 * @swagger
 * /api/admin/users/online:
 *   get:
 *     summary: Get currently online users
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Online users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         onlineUsers:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/User'
 *                         totalOnline:
 *                           type: number
 *                         timestamp:
 *                           type: string
 *                           format: date-time
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get('/users/online',
  adminController.getOnlineUsers
);

/**
 * @swagger
 * /api/admin/search/reindex:
 *   post:
 *     summary: Reindex all messages in Elasticsearch
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Messages reindexed successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         totalProcessed:
 *                           type: number
 *                         timestamp:
 *                           type: string
 *                           format: date-time
 *       503:
 *         description: Elasticsearch not available
 */
router.post('/search/reindex',
  adminController.reindexMessages
);

/**
 * @swagger
 * /api/admin/search/stats:
 *   get:
 *     summary: Get Elasticsearch search statistics
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Search statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         statistics:
 *                           type: object
 *                         elasticsearch:
 *                           type: object
 *                         timestamp:
 *                           type: string
 *                           format: date-time
 *       503:
 *         description: Elasticsearch not available
 */
router.get('/search/stats',
  adminController.getSearchStats
);

module.exports = router;