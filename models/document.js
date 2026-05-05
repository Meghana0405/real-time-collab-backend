const mongoose = require("mongoose");

const DocumentSchema = new mongoose.Schema({

  title: {
    type: String,
    required: true
  },

  // Quill Delta JSON storage
  content: {
    type: Object,
    default: {}
  },

  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  // collaborators with roles
  collaborators: [

    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },

      role: {
        type: String,
        enum: ["editor", "viewer"],
        default: "viewer"
      }

    }

  ],

  // optional: track last editor
  lastEditedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }

},
{
  timestamps: true
});

module.exports =
mongoose.model("Document", DocumentSchema);