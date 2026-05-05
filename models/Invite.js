const mongoose = require("mongoose");

const InviteSchema = new mongoose.Schema({

  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Document"
  },

  email: String,

  role: {
    type: String,
    enum: ["viewer", "editor"],
    default: "viewer"
  },

  token: String,

  expiresAt: Date

});

module.exports =
mongoose.model("Invite", InviteSchema);