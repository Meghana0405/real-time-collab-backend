// ================= IMPORTS =================
const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { createClient } = require("redis");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const sanitizeHtml = require("sanitize-html");

const User = require("./models/User");
const Document = require("./models/document");
// (keep your other models if used)
// const Invite = require("./models/Invite");
// const Comment = require("./models/Comment");
// const Version = require("./models/Version");

const app = express();
const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || "mysecretkey";

// ================= CORS =================
// allow local + all vercel deployments
const allowedOrigins = [
  "http://localhost:5173",
  "https://real-time-collab-frontend-qdo6.vercel.app"
];

const allowOrigin = (origin, callback) => {
  if (!origin) return callback(null, true);
  if (
    allowedOrigins.includes(origin) ||
    origin.endsWith(".vercel.app")
  ) {
    return callback(null, true);
  }
  return callback(new Error("CORS blocked ❌"));
};

app.use(
  cors({
    origin: allowOrigin,
    credentials: true
  })
);

// ================= SOCKET =================
const io = new Server(server, {
  cors: {
    origin: allowOrigin,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ================= MIDDLEWARE =================
app.use(express.json());
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
  })
);

// simple sanitizer
function sanitizeData(data) {
  if (typeof data === "string") {
    return sanitizeHtml(data, { allowedTags: [], allowedAttributes: {} });
  }
  if (data && typeof data === "object") {
    const out = Array.isArray(data) ? [] : {};
    for (const k in data) out[k] = sanitizeData(data[k]);
    return out;
  }
  return data;
}

app.use((req, _res, next) => {
  if (req.body) req.body = sanitizeData(req.body);
  next();
});

// ================= DATABASE =================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected ✅"))
  .catch((err) => console.log("DB ERROR:", err));

// ================= REDIS (optional pub/sub) =================
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT)
  },
  password: process.env.REDIS_PASSWORD
});

redisClient.on("error", (err) => console.log("Redis Error ❌:", err));

const pubClient = redisClient.duplicate();
const subClient = redisClient.duplicate();

(async () => {
  try {
    await redisClient.connect();
    await pubClient.connect();
    await subClient.connect();
    console.log("Redis Ready 🚀");

    await subClient.pSubscribe("doc:*", (message, channel) => {
      const documentId = channel.split(":")[1];
      io.to(documentId).emit("receive-changes", JSON.parse(message));
    });
  } catch (e) {
    console.log("Redis init skipped/failed:", e.message);
  }
})();

// ================= AUTH MIDDLEWARE =================
const authMiddleware = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: "Access denied" });

  try {
    const token = auth.replace("Bearer ", "");
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(400).json({ message: "Invalid token" });
  }
};

// ================= ROOT =================
app.get("/", (_req, res) => {
  res.send("Backend is running 🚀");
});

// ================= HEALTH =================
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ================= AUTH ROUTES =================
app.post("/register", async (req, res) => {
  const { email, password } = req.body;

  const exists = await User.findOne({ email });
  if (exists) return res.json({ message: "User exists" });

  const hash = await bcrypt.hash(password, 10);
  await new User({ email, password: hash }).save();

  res.json({ message: "Registered successfully" });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.json({ message: "User not found" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.json({ message: "Wrong password" });

  const token = jwt.sign({ userId: user._id }, JWT_SECRET);

  res.json({ token, userId: user._id });
});

// ================= DOCUMENT ROUTES =================

// CREATE
app.post("/documents", authMiddleware, async (req, res) => {
  const doc = new Document({
    title: req.body.title || "Untitled",
    content: {},
    owner: req.user.userId
  });

  await doc.save();
  res.json(doc);
});

// LIST
app.get("/documents", authMiddleware, async (req, res) => {
  const docs = await Document.find({
    $or: [
      { owner: req.user.userId },
      { "collaborators.userId": req.user.userId }
    ]
  });

  res.json(docs);
});

// GET ONE (safer)
app.get("/documents/:id", authMiddleware, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({ message: "Document not found ❌" });
    }

    res.json(doc);
  } catch (err) {
    console.error("Fetch Error:", err);
    res.status(500).json({ message: "Server error ❌" });
  }
});

// UPDATE (🔥 THIS WAS MISSING)
app.put("/documents/:id", authMiddleware, async (req, res) => {
  try {
    const { content, title } = req.body;

    const doc = await Document.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({ message: "Document not found ❌" });
    }

    // optional ownership check
    if (doc.owner.toString() !== req.user.userId) {
      return res.status(403).json({ message: "Not allowed ❌" });
    }

    if (typeof title !== "undefined") doc.title = title;
    if (typeof content !== "undefined") doc.content = content;

    await doc.save();

    res.json({ message: "Document updated ✅", doc });
  } catch (err) {
    console.error("Update Error:", err);
    res.status(500).json({ message: "Server error ❌" });
  }
});

// ================= SOCKET EVENTS =================
const socketUsers = {};

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  socket.on("join-document", async ({ documentId, userId }) => {
    socket.join(documentId);
    socketUsers[socket.id] = { documentId, userId };

    try {
      await redisClient.sAdd(`doc:${documentId}`, userId);
      const users = await redisClient.sMembers(`doc:${documentId}`);
      io.to(documentId).emit("active-users", users);
    } catch {}
  });

  socket.on("send-changes", async ({ documentId, delta }) => {
    try {
      await pubClient.publish(`doc:${documentId}`, JSON.stringify(delta));
    } catch {
      // fallback if redis not ready
      socket.to(documentId).emit("receive-changes", delta);
    }
  });

  socket.on("disconnect", async () => {
    const user = socketUsers[socket.id];
    if (!user) return;

    const { documentId, userId } = user;

    try {
      await redisClient.sRem(`doc:${documentId}`, userId);
      const users = await redisClient.sMembers(`doc:${documentId}`);
      io.to(documentId).emit("active-users", users);
    } catch {}

    delete socketUsers[socket.id];
  });
});

// ================= START =================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log("Server running 🚀 on port", PORT);
});