const mongoose = require('mongoose');

const autoMessageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: [true, 'Auto message content is required'],
      maxlength: [500, 'Auto message cannot exceed 500 characters']
    },
    sendDate: {
      type: Date,
      required: true
    },
    isQueued: {
      type: Boolean,
      default: false
    },
    queuedAt: {
      type: Date
    },
    isSent: {
      type: Boolean,
      default: false
    },
    sentAt: {
      type: Date
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation'
    },
    errorMessage: {
      type: String
    },
    retryCount: {
      type: Number,
      default: 0,
      max: 3
    },
    metadata: {
      generationRound: {
        type: Date,
        required: true
      },
      messageTemplate: String,
      pairIndex: Number
    }
  },
  {
    timestamps: true
  }
);

autoMessageSchema.index({ sendDate: 1 });
autoMessageSchema.index({ isQueued: 1, isSent: 1 });
autoMessageSchema.index({ sender: 1, receiver: 1 });
autoMessageSchema.index({ isSent: 1, sendDate: 1 });
autoMessageSchema.index({ 'metadata.generationRound': 1 });

autoMessageSchema.index({
  sendDate: 1,
  isQueued: 1,
  isSent: 1
});

autoMessageSchema.statics.findReadyForQueue = function () {
  return this.find({
    sendDate: { $lte: new Date() },
    isQueued: false,
    isSent: false,
    retryCount: { $lt: 3 }
  })
    .populate('sender', 'username email isActive')
    .populate('receiver', 'username email isActive')
    .sort({ sendDate: 1 });
};

autoMessageSchema.statics.findByGenerationRound = function (roundDate) {
  return this.find({
    'metadata.generationRound': roundDate
  })
    .populate('sender', 'username email')
    .populate('receiver', 'username email');
};

autoMessageSchema.statics.getGenerationStats = function (roundDate) {
  return this.aggregate([
    { $match: { 'metadata.generationRound': roundDate } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        queued: { $sum: { $cond: ['$isQueued', 1, 0] } },
        sent: { $sum: { $cond: ['$isSent', 1, 0] } },
        failed: { $sum: { $cond: [{ $gte: ['$retryCount', 3] }, 1, 0] } }
      }
    }
  ]);
};

autoMessageSchema.methods.markAsQueued = function () {
  this.isQueued = true;
  this.queuedAt = new Date();
  return this.save();
};

autoMessageSchema.methods.markAsSent = function (messageId, conversationId) {
  this.isSent = true;
  this.sentAt = new Date();
  this.messageId = messageId;
  this.conversationId = conversationId;
  return this.save();
};

autoMessageSchema.methods.handleRetry = function (errorMessage) {
  this.retryCount += 1;
  this.errorMessage = errorMessage;
  this.isQueued = false;

  if (this.retryCount >= 3) {
    this.errorMessage = `Max retries reached: ${errorMessage}`;
  }

  return this.save();
};

autoMessageSchema.methods.canRetry = function () {
  return this.retryCount < 3 && !this.isSent;
};

autoMessageSchema.virtual('status').get(function () {
  if (this.isSent) {
    return 'sent';
  }
  if (this.retryCount >= 3) {
    return 'failed';
  }
  if (this.isQueued) {
    return 'queued';
  }
  if (this.sendDate <= new Date()) {
    return 'ready';
  }
  return 'scheduled';
});

autoMessageSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('AutoMessage', autoMessageSchema);
