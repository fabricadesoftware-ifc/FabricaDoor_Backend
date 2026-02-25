const { DOOR_KEY } = require("../config");
const { logger } = require("../middlewares");

let espSocket = null;
let mainIo = null;

const COMMAND_TIMEOUT_MS = 10000;

/**
 * Inicializa o namespace /esp no socket.io para comunicação com o ESP32.
 * @param {import("socket.io").Server} io
 */
function init(io) {
  mainIo = io;

  const espNamespace = io.of("/esp");

  espNamespace.use((socket, next) => {
    const key = socket.handshake.auth?.key;
    logger.info(
      `ESP /esp auth attempt - received key: "${key}" | expected: "${DOOR_KEY}" | match: ${key === DOOR_KEY}`,
    );
    logger.info(`ESP handshake: ${JSON.stringify(socket.handshake.auth)}`);
    if (key === DOOR_KEY) {
      logger.info(`ESP auth success from ${socket.id}`);
      next();
    } else {
      logger.warn(`ESP connection rejected: invalid key (got "${key}")`);
      next(new Error("Authentication failed"));
    }
  });

  espNamespace.on("connection", (socket) => {
    logger.info(`ESP32 connected: ${socket.id}`);

    // Se já tem um ESP conectado, desconecta o antigo
    if (espSocket && espSocket.connected) {
      logger.warn(`Replacing previous ESP connection: ${espSocket.id}`);
      espSocket.disconnect(true);
    }

    espSocket = socket;

    // Notifica o frontend que o ESP está online
    mainIo.emit("esp:status", { online: true });

    socket.on("disconnect", (reason) => {
      logger.info(`ESP32 disconnected: ${reason}`);
      if (espSocket?.id === socket.id) {
        espSocket = null;
      }
      mainIo.emit("esp:status", { online: false });
    });

    // Log de eventos genéricos do ESP (heartbeat, status, etc.)
    socket.on("heartbeat", (data) => {
      logger.debug(`ESP heartbeat: ${JSON.stringify(data)}`);
    });
  });

  logger.info("ESP namespace /esp ready");
}

/**
 * Envia um comando ao ESP32 e aguarda resposta via callback.
 * @param {string} action - Nome do comando (ex: "open-door", "toggle-mode")
 * @param {object} [payload={}] - Dados adicionais
 * @returns {Promise<object>} Resposta do ESP
 */
function sendCommand(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!espSocket || !espSocket.connected) {
      return reject(new Error("ESP32 não está conectado"));
    }

    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Comando '${action}' timeout após ${COMMAND_TIMEOUT_MS / 1000}s`,
        ),
      );
    }, COMMAND_TIMEOUT_MS);

    espSocket.emit("command", { action, ...payload }, (response) => {
      clearTimeout(timeout);
      if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Verifica se o ESP32 está conectado.
 * @returns {boolean}
 */
function isConnected() {
  return espSocket !== null && espSocket.connected;
}

/**
 * Retorna informações do ESP conectado.
 * @returns {object|null}
 */
function getStatus() {
  if (!espSocket || !espSocket.connected) {
    return { online: false };
  }
  return {
    online: true,
    socketId: espSocket.id,
    connectedAt: espSocket.handshake.time,
  };
}

module.exports = { init, sendCommand, isConnected, getStatus };
