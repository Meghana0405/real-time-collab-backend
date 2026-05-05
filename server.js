const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const { createClient } = require("redis");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const sanitizeHtml = require("sanitize-html");

const emailQueue = require("./queue/emailQueue");

const User = require("./models/User");
const Document = require("./models/document");
const Invite = require("./models/Invite");
const Comment = require("./models/Comment");
const Version = require("./models/Version");

const app = express();
const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || "mysecretkey";

// ================= CORS CONFIG =================
const allowedOrigins = [
  "http://localhost:5173",
  "https://real-time-collab-frontend-qdo6.vercel.app"
];

// 🔥 Allow ALL Vercel deployments dynamically
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.includes(origin) ||
        origin.includes(".vercel.app")
      ) {
        return callback(null, true);
      }

      return callback(new Error("CORS blocked ❌"));
    },
    credentials: true
  })
);

// ================= SOCKET =================
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.includes(origin) ||
        origin.includes(".vercel.app")
      ) {
        return callback(null, true);
      }

      return callback(new Error("Socket CORS blocked ❌"));
    },
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

// ================= SANITIZE =================
function sanitizeData(data) {
  if (typeof data === "string") {
    return sanitizeHtml(data, { allowedTags: [], allowedAttributes: {} });
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

// ================= REDIS =================
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
  await redisClient.connect();
  await pubClient.connect();
  await subClient.connect();
  console.log("Redis Ready 🚀");

  await subClient.pSubscribe("doc:*", (message, channel) => {
    const documentId = channel.split(":")[1];
    io.to(documentId).emit("receive-changes", JSON.parse(message));
  });
})();

// ================= AUTH =================
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ message: "Access denied" });

  try {
    const decoded = jwt.verify(token.replace("Bearer ", ""), JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(400).json({ message: "Invalid token" });
  }
};

// ================= ROOT ROUTE =================
app.get("/", (req, res) => {
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

  res.json({
    token,
    userId: user._id
  });
});

// ================= DOCUMENT =================
app.post("/documents", authMiddleware, async (req, res) => {
  const doc = new Document({
    title: req.body.title || "Untitled",
    content: {},
    owner: req.user.userId
  });

  await doc.save();
  res.json(doc);
});

app.get("/documents", authMiddleware, async (req, res) => {
  const docs = await Document.find({
    $or: [
      { owner: req.user.userId },
      { "collaborators.userId": req.user.userId }
    ]
  });

  res.json(docs);
});

app.get("/documents/:id", authMiddleware, async (req, res) => {
  const doc = await Document.findById(req.params.id);
  res.json(doc);
});

// ================= SOCKET EVENTS =================
const socketUsers = {};

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  socket.on("join-document", async ({ documentId, userId }) => {
    socket.join(documentId);
    socketUsers[socket.id] = { documentId, userId };

    await redisClient.sAdd(`doc:${documentId}`, userId);
    const users = await redisClient.sMembers(`doc:${documentId}`);

    io.to(documentId).emit("active-users", users);
  });

  socket.on("send-changes", async ({ documentId, delta }) => {
    await pubClient.publish(`doc:${documentId}`, JSON.stringify(delta));
  });

  socket.on("disconnect", async () => {
    const user = socketUsers[socket.id];
    if (!user) return;

    const { documentId, userId } = user;

    await redisClient.sRem(`doc:${documentId}`, userId);
    const users = await redisClient.sMembers(`doc:${documentId}`);

    io.to(documentId).emit("active-users", users);
    delete socketUsers[socket.id];
  });
});

// ================= START =================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log("Server running 🚀 on port", PORT);
});