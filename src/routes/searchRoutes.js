const express = require("express");
const { body, query, validationResult } = require("express-validator");
const router = express.Router();
const auth = require("../middleware/auth");
const { rateLimiters } = require("../middleware/rateLimiter");
const { messageSearchService } = require("../services/elasticsearch");
const logger = require("../utils/logger");

/**
 * @swagger
 * components:
 *   schemas:
 *     SearchResults:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             messages:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                     example: "507f1f77bcf86cd799439011"
 *                   content:
 *                     type: string
 *                     example: "Hello world"
 *                   conversationId:
 *                     type: string
 *                     example: "507f1f77bcf86cd799439012"
 *                   senderId:
 *                     type: string
 *                     example: "507f1f77bcf86cd799439013"
 *                   messageType:
 *                     type: string
 *                     enum: [text, auto]
 *                     example: "text"
 *                   timestamp:
 *                     type: string
 *                     format: date-time
 *                     example: "2023-12-01T10:30:00.000Z"
 *                   score:
 *                     type: number
 *                     example: 1.5
 *             pagination:
 *               type: object
 *               properties:
 *                 page:
 *                   type: integer
 *                   example: 1
 *                 limit:
 *                   type: integer
 *                   example: 20
 *                 total:
 *                   type: integer
 *                   example: 100
 *                 totalPages:
 *                   type: integer
 *                   example: 5
 *     Suggestions:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             suggestions:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["hello", "help", "here"]
 *             query:
 *               type: string
 *               example: "he"
 *     Statistics:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             totalMessages:
 *               type: integer
 *               example: 1500
 *             messagesByType:
 *               type: object
 *               properties:
 *                 text:
 *                   type: integer
 *                   example: 1200
 *                 auto:
 *                   type: integer
 *                   example: 300
 *             messagesByDate:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   date:
 *                     type: string
 *                     format: date
 *                     example: "2023-12-01"
 *                   count:
 *                     type: integer
 *                     example: 50
 *             topSenders:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   senderId:
 *                     type: string
 *                     example: "507f1f77bcf86cd799439013"
 *                   count:
 *                     type: integer
 *                     example: 100
 *   tags:
 *     - name: Search
 *       description: Message search operations
 */

const searchValidation = [
  query("q")
    .optional()
    .isString()
    .isLength({ min: 1, max: 200 })
    .withMessage("Query must be 1-200 characters"),
  query("conversationId")
    .optional()
    .isMongoId()
    .withMessage("Invalid conversation ID"),
  query("senderId").optional().isMongoId().withMessage("Invalid sender ID"),
  query("messageType")
    .optional()
    .isIn(["text", "auto"])
    .withMessage("Invalid message type"),
  query("dateFrom")
    .optional()
    .isISO8601()
    .withMessage("Invalid date format for dateFrom"),
  query("dateTo")
    .optional()
    .isISO8601()
    .withMessage("Invalid date format for dateTo"),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),
  query("sortBy")
    .optional()
    .isIn(["relevance", "date"])
    .withMessage("Invalid sort field"),
  query("sortOrder")
    .optional()
    .isIn(["asc", "desc"])
    .withMessage("Invalid sort order"),
];

const suggestionsValidation = [
  query("prefix")
    .isString()
    .isLength({ min: 1, max: 50 })
    .withMessage("Prefix must be 1-50 characters"),
  query("conversationId")
    .optional()
    .isMongoId()
    .withMessage("Invalid conversation ID"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage("Limit must be between 1 and 20"),
];

const statisticsValidation = [
  query("period")
    .optional()
    .isIn(["day", "week", "month", "year"])
    .withMessage("Invalid period"),
  query("conversationId")
    .optional()
    .isMongoId()
    .withMessage("Invalid conversation ID"),
];

/**
 * @swagger
 * /api/search/messages:
 *   get:
 *     summary: Search messages
 *     description: Search for messages based on various criteria including text content, sender, date range, and more
 *     tags: [Search]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 200
 *         description: Search query text
 *         example: "hello world"
 *       - in: query
 *         name: conversationId
 *         schema:
 *           type: string
 *           pattern: '^[0-9a-fA-F]{24}$'
 *         description: Filter by conversation ID
 *         example: "507f1f77bcf86cd799439012"
 *       - in: query
 *         name: senderId
 *         schema:
 *           type: string
 *           pattern: '^[0-9a-fA-F]{24}$'
 *         description: Filter by sender ID
 *         example: "507f1f77bcf86cd799439013"
 *       - in: query
 *         name: messageType
 *         schema:
 *           type: string
 *           enum: [text, auto]
 *         description: Filter by message type
 *         example: "text"
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date for date range filter
 *         example: "2023-12-01T00:00:00.000Z"
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date for date range filter
 *         example: "2023-12-31T23:59:59.000Z"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *         example: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of results per page
 *         example: 20
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [relevance, date]
 *           default: relevance
 *         description: Sort results by relevance or date
 *         example: "relevance"
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *         example: "desc"
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SearchResults'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/RateLimitError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/messages",
  auth.authenticate,
  rateLimiters.search,
  searchValidation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const searchOptions = {
        query: req.query.q,
        conversationId: req.query.conversationId,
        userId: req.user.id,
        senderId: req.query.senderId,
        messageType: req.query.messageType,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
        sortBy: req.query.sortBy || "relevance",
        sortOrder: req.query.sortOrder || "desc",
      };

      const results = await messageSearchService.searchMessages(searchOptions);

      res.json({
        success: true,
        data: results,
      });
    } catch (error) {
      logger.error("Search messages error:", error);
      res.status(500).json({
        success: false,
        message: "Search operation failed",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },
);

/**
 * @swagger
 * /api/search/suggestions:
 *   get:
 *     summary: Get search suggestions
 *     description: Get autocomplete suggestions for search queries based on message content
 *     tags: [Search]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: prefix
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 50
 *         description: Text prefix to get suggestions for
 *         example: "he"
 *       - in: query
 *         name: conversationId
 *         schema:
 *           type: string
 *           pattern: '^[0-9a-fA-F]{24}$'
 *         description: Filter suggestions by conversation ID
 *         example: "507f1f77bcf86cd799439012"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 20
 *           default: 5
 *         description: Number of suggestions to return
 *         example: 5
 *     responses:
 *       200:
 *         description: Search suggestions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Suggestions'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/RateLimitError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/suggestions",
  auth.authenticate,
  rateLimiters.search,
  suggestionsValidation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const options = {
        prefix: req.query.prefix,
        conversationId: req.query.conversationId,
        userId: req.user.id,
        limit: parseInt(req.query.limit) || 5,
      };

      const suggestions = await messageSearchService.getSuggestions(options);

      res.json({
        success: true,
        data: {
          suggestions,
          query: req.query.prefix,
        },
      });
    } catch (error) {
      logger.error("Get suggestions error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get suggestions",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },
);

/**
 * @swagger
 * /api/search/statistics:
 *   get:
 *     summary: Get message statistics
 *     description: Get statistical information about messages including counts by type, date, and top senders
 *     tags: [Search]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [day, week, month, year]
 *           default: month
 *         description: Time period for statistics
 *         example: "month"
 *       - in: query
 *         name: conversationId
 *         schema:
 *           type: string
 *           pattern: '^[0-9a-fA-F]{24}$'
 *         description: Filter statistics by conversation ID
 *         example: "507f1f77bcf86cd799439012"
 *     responses:
 *       200:
 *         description: Message statistics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Statistics'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/RateLimitError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/statistics",
  auth.authenticate,
  rateLimiters.search,
  statisticsValidation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const options = {
        period: req.query.period || "month",
        conversationId: req.query.conversationId,
        userId: req.user.id,
      };

      const statistics = await messageSearchService.getStatistics(options);

      res.json({
        success: true,
        data: statistics,
      });
    } catch (error) {
      logger.error("Get statistics error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get statistics",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },
);

module.exports = router;
