const express = require('express');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const conversationRoutes = require('./conversationRoutes');
const adminRoutes = require('./adminRoutes');
const searchRoutes = require('./searchRoutes');

const router = express.Router();


router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/conversations', conversationRoutes);
router.use('/admin', adminRoutes);
router.use('/search', searchRoutes);


router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Real-Time Messaging System API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/register': 'Register new user',
        'POST /api/auth/login': 'User login',
        'POST /api/auth/refresh': 'Refresh access token',
        'POST /api/auth/logout': 'User logout',
        'POST /api/auth/logout-all': 'Logout from all devices',
        'GET /api/auth/me': 'Get current user profile',
        'PUT /api/auth/change-password': 'Change password'
      },
      users: {
        'GET /api/user/list': 'Get user list with pagination',
        'GET /api/user/search': 'Search users',
        'GET /api/user/online/stats': 'Get online user statistics',
        'GET /api/user/:id': 'Get user by ID',
        'PUT /api/user/profile': 'Update user profile'
      },
      conversations: {
        'GET /api/conversations': 'Get user conversations',
        'POST /api/conversations': 'Create new conversation',
        'GET /api/conversations/:id': 'Get conversation details',
        'GET /api/conversations/:id/messages': 'Get conversation messages',
        'POST /api/conversations/:id/messages': 'Send message',
        'PUT /api/conversations/:id/messages/:messageId/read': 'Mark message as read',
        'DELETE /api/conversations/:id': 'Delete conversation'
      },
      admin: {
        'GET /api/admin/status': 'System status overview',
        'GET /api/admin/health': 'Health check',
        'GET /api/admin/jobs/status': 'Job status',
        'GET /api/admin/jobs/statistics': 'Job statistics',
        'POST /api/admin/jobs/trigger/planner': 'Trigger auto message planner',
        'POST /api/admin/jobs/trigger/worker': 'Trigger queue worker',
        'POST /api/admin/jobs/control/:job/:action': 'Control jobs (start/stop)',
        'POST /api/admin/jobs/restart': 'Restart all jobs',
        'POST /api/admin/maintenance': 'Run maintenance',
        'GET /api/admin/messages/auto': 'Get auto messages',
        'GET /api/admin/templates': 'Get message templates',
        'GET /api/admin/users/online': 'Get online users'
      },
      search: {
        'GET /api/search/messages': 'Search messages with Elasticsearch',
        'GET /api/search/suggestions': 'Get message content suggestions',
        'GET /api/search/statistics': 'Get search and message statistics'
      }
    },
    documentation: 'Visit /api-docs for detailed API documentation',
    timestamp: new Date().toISOString()
  });
});


/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Basic health check
 *     description: Simple health check endpoint that returns server status and uptime
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2023-12-01T10:30:00.000Z"
 *                 uptime:
 *                   type: number
 *                   description: Server uptime in seconds
 *                   example: 3600
 *                 environment:
 *                   type: string
 *                   example: "development"
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

module.exports = router;