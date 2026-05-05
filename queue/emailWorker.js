require("dotenv").config();

const { Worker } = require("bullmq");
const nodemailer = require("nodemailer");

console.log("REDIS PORT:", process.env.REDIS_PORT); // 🔥 DEBUG

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

new Worker(
  "emailQueue",
  async (job) => {

    const { to, subject, html } = job.data;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html
    });

    console.log("📧 Email sent:", to);

  },
  {
    connection: {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT), // now works
      password: process.env.REDIS_PASSWORD
    }
  }
);