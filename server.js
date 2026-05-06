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
const nodemailer = require("nodemailer");

const User = require("./models/User");
const Document = require("./models/document");

const app = express();
const server = http.createServer(app);

const JWT_SECRET =
  process.env.JWT_SECRET || "mysecretkey";

// ================= EMAIL CONFIG =================
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,

  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },

  tls: {
    rejectUnauthorized: false
  }
});

// ✅ Verify SMTP
transporter.verify((error) => {

  if (error) {

    console.error(
      "❌ SMTP ERROR:",
      error.message
    );

  } else {

    console.log(
      "✅ SMTP SERVER READY"
    );

  }
});

// ================= CORS =================
const allowedOrigins = [
  "http://localhost:5173",
  "https://real-time-collab-frontend-rho.vercel.app"
];

const allowOrigin = (origin, callback) => {

  if (!origin) {
    return callback(null, true);
  }

  if (
    allowedOrigins.includes(origin) ||
    origin.endsWith(".vercel.app")
  ) {
    return callback(null, true);
  }

  return callback(
    new Error("CORS blocked ❌")
  );
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

// ================= SANITIZE =================
function sanitizeData(data) {

  if (typeof data === "string") {

    return sanitizeHtml(data, {
      allowedTags: [],
      allowedAttributes: {}
    });

  }

  if (data && typeof data === "object") {

    const out = Array.isArray(data)
      ? []
      : {};

    for (const k in data) {
      out[k] = sanitizeData(data[k]);
    }

    return out;
  }

  return data;
}

app.use((req, _res, next) => {

  if (req.body) {
    req.body = sanitizeData(req.body);
  }

  next();
});

// ================= DATABASE =================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() =>
    console.log("MongoDB connected ✅")
  )
  .catch((err) =>
    console.log("DB ERROR:", err)
  );

// ================= REDIS =================
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT)
  },

  password: process.env.REDIS_PASSWORD
});

const pubClient = redisClient.duplicate();
const subClient = redisClient.duplicate();

(async () => {

  try {

    await redisClient.connect();
    await pubClient.connect();
    await subClient.connect();

    await subClient.pSubscribe(
      "doc:*",
      (message, channel) => {

        const documentId =
          channel.split(":")[1];

        io.to(documentId).emit(
          "receive-changes",
          JSON.parse(message)
        );
      }
    );

    console.log("Redis Ready 🚀");

  } catch (e) {

    console.log(
      "Redis skipped:",
      e.message
    );

  }
})();

// ================= AUTH =================
const authMiddleware = (
  req,
  res,
  next
) => {

  const auth =
    req.headers.authorization;

  if (!auth) {

    return res.status(401).json({
      message: "Access denied"
    });

  }

  try {

    const token = auth.replace(
      "Bearer ",
      ""
    );

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    req.user = decoded;

    next();

  } catch {

    return res.status(400).json({
      message: "Invalid token"
    });

  }
};

// ================= ROOT =================
app.get("/", (_req, res) => {

  res.send("Backend is running 🚀");

});

// ================= HEALTH =================
app.get("/health", (_req, res) => {

  res.json({
    status: "ok"
  });

});

// ================= METRICS =================
app.get("/metrics", (_req, res) => {

  res.json({
    uptime: process.uptime(),
    timestamp: Date.now(),
    memory: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
    platform: process.platform
  });

});

// ================= REGISTER =================
app.post(
  "/register",
  async (req, res) => {

    try {

      const {
        email,
        password
      } = req.body;

      const exists =
        await User.findOne({
          email
        });

      if (exists) {

        return res.json({
          message: "User exists"
        });

      }

      const hash =
        await bcrypt.hash(
          password,
          10
        );

      await new User({
        email,
        password: hash
      }).save();

      res.json({
        message:
          "Registered successfully"
      });

    } catch (err) {

      res.status(500).json({
        message: "Register failed"
      });

    }
  }
);

// ================= LOGIN =================
app.post(
  "/login",
  async (req, res) => {

    try {

      const {
        email,
        password
      } = req.body;

      const user =
        await User.findOne({
          email
        });

      if (!user) {

        return res.json({
          message:
            "User not found"
        });

      }

      const ok =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!ok) {

        return res.json({
          message:
            "Wrong password"
        });

      }

      const token = jwt.sign(
        {
          userId: user._id
        },
        JWT_SECRET
      );

      res.json({
        token,
        userId: user._id
      });

    } catch (err) {

      res.status(500).json({
        message: "Login failed"
      });

    }
  }
);

// ================= CREATE DOCUMENT =================
app.post(
  "/documents",
  authMiddleware,
  async (req, res) => {

    const doc = new Document({
      title:
        req.body.title ||
        "Untitled",

      content: {},

      owner:
        req.user.userId,

      collaborators: []
    });

    await doc.save();

    res.json(doc);
  }
);

// ================= GET ALL DOCUMENTS =================
app.get(
  "/documents",
  authMiddleware,
  async (req, res) => {

    const docs =
      await Document.find({
        $or: [
          {
            owner:
              req.user.userId
          },
          {
            "collaborators.userId":
              req.user.userId
          }
        ]
      });

    res.json(docs);
  }
);

// ================= GET SINGLE DOCUMENT =================
app.get(
  "/documents/:id",
  authMiddleware,
  async (req, res) => {

    const doc =
      await Document.findById(
        req.params.id
      );

    if (!doc) {

      return res
        .status(404)
        .json({
          message:
            "Document not found ❌"
        });

    }

    res.json(doc);
  }
);

// ================= UPDATE DOCUMENT =================
app.put(
  "/documents/:id",
  authMiddleware,
  async (req, res) => {

    try {

      const doc =
        await Document.findById(
          req.params.id
        );

      if (!doc) {

        return res
          .status(404)
          .json({
            message:
              "Document not found ❌"
          });

      }

      doc.content =
        req.body.content;

      await doc.save();

      res.json({
        success: true,
        message:
          "Document updated ✅"
      });

    } catch (err) {

      console.error(
        "UPDATE ERROR:",
        err
      );

      res.status(500).json({
        success: false,
        message:
          "Update failed"
      });

    }
  }
);

// ================= DELETE DOCUMENT =================
app.delete(
  "/documents/:id",
  authMiddleware,
  async (req, res) => {

    try {

      const doc =
        await Document.findById(
          req.params.id
        );

      if (!doc) {

        return res
          .status(404)
          .json({
            success: false,
            message:
              "Document not found ❌"
          });

      }

      // only owner can delete
      if (
        doc.owner.toString() !==
        req.user.userId
      ) {

        return res
          .status(403)
          .json({
            success: false,
            message:
              "Not allowed ❌"
          });

      }

      await Document.findByIdAndDelete(
        req.params.id
      );

      res.json({
        success: true,
        message:
          "Document deleted ✅"
      });

    } catch (err) {

      console.error(
        "DELETE ERROR:",
        err
      );

      res.status(500).json({
        success: false,
        message:
          "Delete failed"
      });

    }
  }
);

// ================= INVITE =================
app.post(
  "/documents/:id/invite",
  authMiddleware,
  async (req, res) => {

    try {

      const {
        email,
        role
      } = req.body;

      if (
        !email ||
        !email.includes("@")
      ) {

        return res
          .status(400)
          .json({
            message:
              "Valid email required"
          });

      }

      const doc =
        await Document.findById(
          req.params.id
        );

      if (!doc) {

        return res
          .status(404)
          .json({
            message:
              "Document not found"
          });

      }

      const inviteLink =
        `${process.env.FRONTEND_URL}/editor/${req.params.id}`;

      const info =
        await transporter.sendMail({
          from:
            `"Collaborative Editor" <${process.env.EMAIL_USER}>`,

          to: email,

          subject:
            "📄 Document Collaboration Invite",

          html: `
          <div style="font-family: Arial; padding:20px;">
            <h2>📄 Collaborative Editor Invite</h2>

            <p>
              You have been invited to collaborate on a document.
            </p>

            <p>
              <strong>Role:</strong> ${role}
            </p>

            <a
              href="${inviteLink}"
              style="
                background:#007bff;
                color:white;
                padding:12px 20px;
                text-decoration:none;
                border-radius:6px;
                display:inline-block;
                margin-top:10px;
              "
            >
              Open Document
            </a>

            <p style="margin-top:20px;">
              Or copy this link:
            </p>

            <p>${inviteLink}</p>
          </div>
          `
        });

      console.log(
        "✅ EMAIL SENT:",
        info.response
      );

      res.json({
        success: true,
        message:
          "Invite sent successfully ✅"
      });

    } catch (err) {

      console.error(
        "❌ EMAIL ERROR:",
        err.message
      );

      res.status(500).json({
        success: false,
        message:
          err.message
      });

    }
  }
);

// ================= SOCKET =================
io.on(
  "connection",
  (socket) => {

    console.log(
      "🟢 Socket connected:",
      socket.id
    );

    // ================= JOIN =================
    socket.on(
      "join-document",
      ({
        documentId,
        userId
      }) => {

        socket.join(documentId);

        console.log(
          `👤 ${userId} joined ${documentId}`
        );

        const room =
          io.sockets.adapter.rooms.get(
            documentId
          );

        const activeUsers =
          room
            ? Array.from(room)
            : [];

        io.to(documentId).emit(
          "active-users",
          activeUsers
        );
      }
    );

    // ================= SEND CHANGES =================
    socket.on(
      "send-changes",
      async ({
        documentId,
        delta
      }) => {

        try {

          socket
            .to(documentId)
            .emit(
              "receive-changes",
              delta
            );

          await pubClient.publish(
            `doc:${documentId}`,
            JSON.stringify(delta)
          );

        } catch (err) {

          console.error(
            "Redis Publish Error:",
            err.message
          );

        }
      }
    );

    // ================= CURSOR =================
    socket.on(
      "cursor-change",
      ({
        documentId,
        userId,
        range
      }) => {

        socket
          .to(documentId)
          .emit(
            "receive-cursor",
            {
              userId,
              range
            }
          );
      }
    );

    // ================= TYPING =================
    socket.on(
      "typing",
      ({
        documentId,
        userId
      }) => {

        socket
          .to(documentId)
          .emit(
            "typing",
            userId
          );
      }
    );

    // ================= DISCONNECT =================
    socket.on(
      "disconnect",
      () => {

        console.log(
          "🔴 Socket disconnected:",
          socket.id
        );

      }
    );
  }
);

// ================= START =================
const PORT =
  process.env.PORT || 5000;

server.listen(PORT, () => {

  console.log(
    `🚀 Server running on port ${PORT}`
  );

});