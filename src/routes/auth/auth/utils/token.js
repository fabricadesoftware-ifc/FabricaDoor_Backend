const jwt = require("jsonwebtoken");

const { JWT_SECRET } = require("../../../../config");

const REFRESH_SECRET = JWT_SECRET + "_REFRESH";

function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (error) {
    return { error: error.message };
  }
}

const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "3h" });
};

const generateRefreshToken = (userId) => {
  return jwt.sign({ userId, type: "refresh" }, REFRESH_SECRET, { expiresIn: "7d" });
};

const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET);
    if (decoded.type !== "refresh") {
      return { error: "Token is not a refresh token" };
    }
    return decoded;
  } catch (error) {
    return { error: error.message };
  }
};

const generatePasswordResetToken = (userId) => {
  const token = jwt
    .sign({ userId }, JWT_SECRET, { expiresIn: "5m" })
    .slice(0, 10);
  return token;
};

module.exports = {
  verifyToken,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  generatePasswordResetToken,
};
