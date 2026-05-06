require("dotenv").config();

const { Worker } = require("bullmq");
const nodemailer = require("nodemailer");

console.log("📧 Email Worker Starting...");
console.log("REDIS HOST:", process.env.REDIS_HOST);
console.log("REDIS PORT:", process.env.REDIS_PORT);
console.log("EMAIL USER:", process.env.EMAIL_USER);

// ================= SMTP TRANSPORT =================
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

// ================= VERIFY SMTP =================
transporter.verify((error, success) => {

  if (error) {

    console.error("❌ SMTP CONFIG ERROR:");
    console.error(error);

  } else {

    console.log("✅ SMTP SERVER READY 🚀");

  }
});

// ================= EMAIL WORKER =================
const worker = new Worker(

  "emailQueue",

  async (job) => {

    try {

      const {
        to,
        subject,
        html
      } = job.data;

      console.log(`📤 Sending email to: ${to}`);

      const info = await transporter.sendMail({

        from: `"Collaborative Editor" <${process.env.EMAIL_USER}>`,

        to,

        subject,

        html

      });

      console.log("✅ EMAIL SENT:");
      console.log(info.response);

      return {
        success: true
      };

    } catch (error) {

      console.error("❌ EMAIL FAILED:");
      console.error(error);

      throw error;
    }
  },

  {
    connection: {
      host: process.env.REDIS_HOST,

      port: Number(process.env.REDIS_PORT),

      password: process.env.REDIS_PASSWORD
    }
  }
);

// ================= EVENTS =================
worker.on("completed", (job) => {

  console.log(`✅ Job ${job.id} completed`);

});

worker.on("failed", (job, error) => {

  console.error(`❌ Job ${job?.id} failed`);
  console.error(error.message);

});

worker.on("error", (error) => {

  console.error("❌ Worker Error:");
  console.error(error);

});

console.log("📧 Email Worker Running...");