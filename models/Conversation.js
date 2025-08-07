const mongoose = require("mongoose");

const ConversationSchema = new mongoose.Schema(
  {
    participants: [
      { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User", 
        required: true 
      },
    ],
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    unreadCount: {
      type: Number,
      default: 0
    },
  },
  { 
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function(doc, ret) {
        delete ret.__v;
        return ret;
      }
    }
  }
);

ConversationSchema.index({ participants: 1 });
ConversationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("Conversation", ConversationSchema);