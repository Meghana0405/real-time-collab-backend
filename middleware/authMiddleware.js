const jwt = require("jsonwebtoken");

const JWT_SECRET = "mysecretkey";

module.exports = (req, res, next) => {

  try {

    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        message: "Access denied. Token missing."
      });
    }

    // Remove "Bearer " prefix
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : authHeader;

    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = decoded;

    next();

  } catch (error) {

    res.status(400).json({
      message: "Invalid token"
    });

  }

};