const mongoose = require("mongoose");

const CommentSchema = new mongoose.Schema({

  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Document"
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  text: String,

  range: {
    index: Number,
    length: Number
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  resolved: {
    type: Boolean,
    default: false
},

});

module.exports = mongoose.model("Comment", CommentSchema);