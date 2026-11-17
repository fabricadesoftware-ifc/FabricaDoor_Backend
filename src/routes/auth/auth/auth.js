const express = require("express");

const {
  loginUser,
  registerUser,
  verifyUser,
  forgetPassword,
  resetPassword,
} = require("./utils/auth");
const { validateRequestBody } = require("../../../helpers/validate/request");
const { verifyToken, verifyRefreshToken, generateToken, generateRefreshToken } = require("./utils/token");
const { logger } = require("../../../middlewares");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const router = new express.Router();

/**
 * Rota de login do usuário.
 * Recebe email e senha e retorna token e dados do usuário, sem a senha.
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  // Validação básica dos campos
  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, error: "Email and password are required" });
  }

  try {
    const { token, refreshToken, user } = await loginUser(email, password);
    const { password: _, ...userWithoutPassword } = user;
    return res
      .status(200)
      .json({ success: true, token, refreshToken, data: userWithoutPassword });
  } catch (error) {
    logger.error(`Login route error: ${error.message}`);
    return res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Rota de registro do usuário.
 * Recebe nome, email e senha e cria um novo usuário.
 */
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  // Validação dos campos requeridos
  const error = validateRequestBody(["name", "email", "password"], req.body);
  if (error) {
    return res.status(400).json({ success: false, error });
  }

  try {
    await registerUser(req, email, password, name);
    return res
      .status(201)
      .json({ success: true, message: "User registered successfully" });
  } catch (error) {
    logger.error(`Register route error: ${error.message}`);
    return res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Rota de verificação do usuário.
 * Utiliza o token de autorização para recuperar dados de verificação do usuário.
 */
router.get("/verify", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res
      .status(400)
      .json({ success: false, error: "Authorization token is required" });
  }

  const userData = verifyToken(token);
  if (userData.error) {
    const isExpired = userData.error === "jwt expired";
    return res.status(401).json({
      success: false,
      error: userData.error,
      ...(isExpired && { code: "TOKEN_EXPIRED" }),
    });
  }

  try {
    const userVerification = await verifyUser(userData);
    return res.status(200).json({ success: true, data: userVerification });
  } catch (error) {
    logger.error(`Verify route error: ${error.message}`);
    return res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Rota de refresh token.
 * Recebe o refresh token e retorna um novo access token + novo refresh token.
 */
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res
      .status(400)
      .json({ success: false, error: "Refresh token is required" });
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);
    if (decoded.error) {
      return res
        .status(401)
        .json({ success: false, error: decoded.error });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
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
      return res
        .status(401)
        .json({ success: false, error: "User not found" });
    }

    const newToken = generateToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    return res.status(200).json({
      success: true,
      token: newToken,
      refreshToken: newRefreshToken,
      data: user,
    });
  } catch (error) {
    // O token já foi validado acima; o que chega aqui é falha interna
    // (banco). Responder 401 fazia o frontend deslogar o usuário.
    logger.error(`Refresh token route error: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, error: "Internal error refreshing token" });
  }
});

/**
 * Rota para solicitação de redefinição de senha.
 * Envia email com instruções para redefinir a senha.
 */
router.post("/forget", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: "Email is required" });
  }
  try {
    await forgetPassword(email);
    return res
      .status(200)
      .json({ success: true, message: "Password reset email sent" });
  } catch (error) {
    logger.error(`Forget password route error: ${error.message}`);
    return res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Rota para redefinição de senha.
 * Recebe token e nova senha, e atualiza a senha do usuário.
 */
router.post("/reset", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res
      .status(400)
      .json({ success: false, error: "Token and new password are required" });
  }
  try {
    await resetPassword(token, newPassword);
    return res
      .status(200)
      .json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    logger.error(`Reset password route error: ${error.message}`);
    return res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
