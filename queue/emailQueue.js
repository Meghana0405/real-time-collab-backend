const { Queue } = require("bullmq");

const emailQueue = new Queue("emailQueue", {
  connection: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD
  }
});

module.exports = emailQueue;
