const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { DOOR_KEY } = require("../../config");

const prisma = new PrismaClient();

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Acesso negado. Token malformado ou não fornecido." });
  }

  const token = authHeader.split(" ")[1];
  const secretKey = process.env.JWT_SECRET;

  try {
    if (token == DOOR_KEY) {
      req.user = {
        id: 0,
        name: "ESP32",
        email: "esp32@fabricadoor.local",
        isSuper: true,
        isVerified: true,
        isDevice: true,
      };
      return next();
    }

    const verified = jwt.verify(token, secretKey);
    const userId = verified.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        isSuper: true,
        isVerified: true,
        picture: true,
      },
    });

    if (!user) {
      return res.status(401).json({ message: "Usuário não encontrado." });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Token expirado.",
        code: "TOKEN_EXPIRED",
      });
    }

    if (err.name === "JsonWebTokenError" || err.name === "NotBeforeError") {
      return res.status(401).json({ message: "Token inválido." });
    }

    // Falha de banco ou outro erro interno: responder 401 aqui fazia o
    // frontend deslogar o usuário por um problema que não é de login.
    return res
      .status(500)
      .json({ message: "Erro interno ao validar o acesso." });
  }
};

module.exports = verifyToken;
