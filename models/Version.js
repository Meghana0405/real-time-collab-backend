const mongoose = require("mongoose");

const VersionSchema = new mongoose.Schema({
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Document",
    required: true,
    index: true
  },

  content: {
    type: Object,
    required: true
  }

}, {
  timestamps: true // automatically adds createdAt & updatedAt
});

module.exports = mongoose.model("Version", VersionSchema);