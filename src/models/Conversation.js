const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      }
    ],
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    lastMessageAt: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: true
    },
    conversationType: {
      type: String,
      enum: ['direct', 'group'],
      default: 'direct'
    },
    metadata: {
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      name: String,
      description: String
    }
  },
  {
    timestamps: true
  }
);

conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ isActive: 1 });
conversationSchema.index({ conversationType: 1 });

conversationSchema.pre('save', function (next) {
  if (this.conversationType === 'direct' && this.participants.length !== 2) {
    return next(
      new Error('Direct conversation must have exactly 2 participants')
    );
  }
  if (this.conversationType === 'group' && this.participants.length < 2) {
    return next(
      new Error('Group conversation must have at least 2 participants')
    );
  }
  next();
});

conversationSchema.statics.findBetweenUsers = function (userId1, userId2) {
  return this.findOne({
    conversationType: 'direct',
    participants: { $all: [userId1, userId2] },
    isActive: true
  })
    .populate('participants', 'username email lastSeen')
    .populate('lastMessage');
};

conversationSchema.statics.findUserConversations = function (
  userId,
  page = 1,
  limit = 20
) {
  const skip = (page - 1) * limit;

  return this.find({
    participants: userId,
    isActive: true
  })
    .populate('participants', 'username email lastSeen')
    .populate('lastMessage')
    .sort({ lastMessageAt: -1 })
    .skip(skip)
    .limit(limit);
};

conversationSchema.methods.addParticipant = function (userId) {
  if (!this.participants.includes(userId)) {
    this.participants.push(userId);
    return this.save();
  }
  return this;
};

conversationSchema.methods.removeParticipant = function (userId) {
  this.participants = this.participants.filter((id) => !id.equals(userId));
  return this.save();
};

conversationSchema.methods.updateLastMessage = function (messageId) {
  this.lastMessage = messageId;
  this.lastMessageAt = new Date();
  return this.save();
};

module.exports = mongoose.model('Conversation', conversationSchema);
