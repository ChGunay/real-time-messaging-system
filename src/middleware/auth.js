const { User } = require("../models");
const {
  verifyAccessToken,
  extractTokenFromHeader,
  isTokenBlacklisted,
} = require("../utils/jwt");
const logger = require("../utils/logger");

const authenticate = async (req, res, next) => {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);

    if (await isTokenBlacklisted(token)) {
      return res.status(401).json({
        success: false,
        message: "Token has been invalidated",
      });
    }

    const decoded = verifyAccessToken(token);

    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User account is deactivated",
      });
    }

    req.user = user;
    req.token = token;

    user.updateLastSeen().catch((err) => {
      logger.error("Failed to update last seen:", err);
    });

    next();
  } catch (error) {
    logger.error("Authentication error:", error);

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired",
      });
    }

    return res.status(401).json({
      success: false,
      message: error.message || "Authentication failed",
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    if (!req.headers.authorization) {
      return next();
    }

    const token = extractTokenFromHeader(req.headers.authorization);

    if (await isTokenBlacklisted(token)) {
      return next();
    }

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id).select("-password");

    if (user && user.isActive) {
      req.user = user;
      req.token = token;

      user.updateLastSeen().catch((err) => {
        logger.error("Failed to update last seen:", err);
      });
    }

    next();
  } catch (error) {
    logger.debug("Optional auth failed:", error.message);
    next();
  }
};

const authorize = (resourceField = "userId") => {
  return (req, res, next) => {
    try {
      const resourceOwnerId =
        req.params[resourceField] || req.body[resourceField];

      if (!resourceOwnerId) {
        return res.status(400).json({
          success: false,
          message: `${resourceField} is required`,
        });
      }

      if (req.user.id !== resourceOwnerId) {
        return res.status(403).json({
          success: false,
          message: "Access denied: insufficient permissions",
        });
      }

      next();
    } catch (error) {
      logger.error("Authorization error:", error);
      return res.status(500).json({
        success: false,
        message: "Authorization check failed",
      });
    }
  };
};

const authorizeConversationAccess = async (req, res, next) => {
  try {
    const { Conversation } = require("../models");
    const conversationId = req.params.conversationId || req.body.conversationId;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: "Conversation ID is required",
      });
    }

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    const isParticipant = conversation.participants.some(
      (participantId) => participantId.toString() === req.user.id,
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: "Access denied: not a participant in this conversation",
      });
    }

    req.conversation = conversation;
    next();
  } catch (error) {
    logger.error("Conversation authorization error:", error);
    return res.status(500).json({
      success: false,
      message: "Conversation authorization failed",
    });
  }
};

module.exports = {
  authenticate,
  optionalAuth,
  authorize,
  authorizeConversationAccess,
};
