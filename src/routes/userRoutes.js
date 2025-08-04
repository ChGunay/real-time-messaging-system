const express = require("express");
const userController = require("../controllers/userController");
const { authenticate } = require("../middleware/auth");
const {
  validateQuery,
  validateParams,
  paginationSchema,
  objectIdSchema,
} = require("../middleware/validation");
const rateLimit = require("express-rate-limit");
const Joi = require("joi");

/**
 * @swagger
 * components:
 *   schemas:
 *     UserSearchQuery:
 *       type: object
 *       properties:
 *         search:
 *           type: string
 *           description: Search term for username, email, firstName, or lastName
 *         page:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *           description: Page number
 *         limit:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *           description: Items per page
 *       example:
 *         search: john
 *         page: 1
 *         limit: 10
 *
 *     UserUpdateRequest:
 *       type: object
 *       properties:
 *         username:
 *           type: string
 *           minLength: 3
 *           maxLength: 30
 *           description: Unique username
 *       example:
 *         username: johndoe_updated
 *
 *     OnlineStats:
 *       type: object
 *       properties:
 *         totalUsers:
 *           type: integer
 *           description: Total number of users
 *         onlineUsers:
 *           type: integer
 *           description: Number of currently online users
 *         onlinePercentage:
 *           type: number
 *           format: float
 *           description: Percentage of users online
 *         recentlyActive:
 *           type: integer
 *           description: Users active in the last hour
 *       example:
 *         totalUsers: 150
 *         onlineUsers: 12
 *         onlinePercentage: 8.0
 *         recentlyActive: 25
 */

const router = express.Router();

const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // limit each IP to 20 search requests per minute
  message: {
    success: false,
    message: "Too many search requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const userListQuerySchema = paginationSchema.keys({
  search: Joi.string().trim().min(2).max(50).optional().messages({
    "string.min": "Search query must be at least 2 characters long",
    "string.max": "Search query cannot exceed 50 characters",
  }),
});

const searchQuerySchema = Joi.object({
  q: Joi.string().trim().min(2).max(50).required().messages({
    "string.min": "Search query must be at least 2 characters long",
    "string.max": "Search query cannot exceed 50 characters",
    "any.required": "Search query is required",
  }),
  limit: Joi.number().integer().min(1).max(20).default(10).messages({
    "number.min": "Limit must be at least 1",
    "number.max": "Limit cannot exceed 20",
  }),
});

const updateProfileSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required().messages({
    "string.alphanum": "Username must contain only alphanumeric characters",
    "string.min": "Username must be at least 3 characters long",
    "string.max": "Username cannot exceed 30 characters",
    "any.required": "Username is required",
  }),
});

// Apply authentication to all routes
router.use(authenticate);
router.use(userLimiter);

/**
 * @swagger
 * /api/user/list:
 *   get:
 *     summary: Get user list with pagination
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *     responses:
 *       200:
 *         description: User list retrieved successfully
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
 *                         users:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/User'
 *                         meta:
 *                           $ref: '#/components/schemas/PaginationMeta'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get(
  "/list",
  validateQuery(userListQuerySchema),
  userController.getUserList,
);

/**
 * @swagger
 * /api/user/search:
 *   get:
 *     summary: Search users by username, email, or name
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *           maxLength: 50
 *         description: Search query for username, email, or name
 *         example: "john"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 20
 *           default: 10
 *         description: Number of results to return
 *         example: 10
 *     responses:
 *       200:
 *         description: Search results
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
 *                         users:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/User'
 *                         meta:
 *                           $ref: '#/components/schemas/PaginationMeta'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get(
  "/search",
  searchLimiter,
  validateQuery(searchQuerySchema),
  userController.searchUsers,
);

/**
 * @swagger
 * /api/user/online/stats:
 *   get:
 *     summary: Get online user statistics
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Online user statistics
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/OnlineStats'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get("/online/stats", userController.getOnlineStats);

/**
 * @swagger
 * /api/user/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: User ID
 *         schema:
 *           type: string
 *           format: objectId
 *           example: 507f1f77bcf86cd799439011
 *     responses:
 *       200:
 *         description: User details
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/:id", validateParams(objectIdSchema), userController.getUserById);

/**
 * @swagger
 * /api/user/profile:
 *   put:
 *     summary: Update current user's profile
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserUpdateRequest'
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       409:
 *         description: Username already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put(
  "/profile",
  require("../middleware/validation").validate(updateProfileSchema),
  userController.updateProfile,
);

module.exports = router;
