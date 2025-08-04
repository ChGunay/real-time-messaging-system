const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: [true, 'Message content is required'],
    maxlength: [1000, 'Message cannot exceed 1000 characters']
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'system'],
    default: 'text'
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  attachments: [{
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    url: String
  }],
  metadata: {
    editedAt: Date,
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    deletedAt: Date,
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  isSystemMessage: {
    type: Boolean,
    default: false
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});


messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ status: 1 });
messageSchema.index({ isDeleted: 1 });
messageSchema.index({ createdAt: -1 });


messageSchema.index({ content: 'text' });


messageSchema.statics.getConversationMessages = function(conversationId, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  
  return this.find({
    conversation: conversationId,
    isDeleted: false
  })
  .populate('sender', 'username email')
  .populate('replyTo', 'content sender createdAt')
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit);
};


messageSchema.statics.searchMessages = function(conversationId, searchTerm, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  return this.find({
    conversation: conversationId,
    isDeleted: false,
    $text: { $search: searchTerm }
  })
  .populate('sender', 'username email')
  .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
  .skip(skip)
  .limit(limit);
};


messageSchema.methods.markAsRead = function(userId) {
  const existingRead = this.readBy.find(read => read.user.equals(userId));
  
  if (!existingRead) {
    this.readBy.push({ user: userId, readAt: new Date() });
    this.status = 'read';
    return this.save();
  }
  
  return this;
};


messageSchema.methods.editContent = function(newContent, editorId) {
  this.content = newContent;
  this.metadata.editedAt = new Date();
  this.metadata.editedBy = editorId;
  return this.save();
};


messageSchema.methods.softDelete = function(deleterId) {
  this.isDeleted = true;
  this.metadata.deletedAt = new Date();
  this.metadata.deletedBy = deleterId;
  return this.save();
};


messageSchema.virtual('isEdited').get(function() {
  return !!this.metadata.editedAt;
});

  
messageSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Message', messageSchema);