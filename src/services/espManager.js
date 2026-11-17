const { DOOR_KEY } = require("../config");
const { logger } = require("../middlewares");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

let espSocket = null;

const COMMAND_TIMEOUT_MS = 10000;

function emitCommand(socket, action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!socket || !socket.connected) {
      return reject(new Error("ESP32 não está conectado"));
    }

    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Comando '${action}' timeout após ${COMMAND_TIMEOUT_MS / 1000}s`,
        ),
      );
    }, COMMAND_TIMEOUT_MS);

    socket.emit("command", { action, ...payload }, (response) => {
      clearTimeout(timeout);
      if (response?.error || response?.success === false) {
        reject(new Error(response?.error || `Comando '${action}' falhou`));
      } else {
        resolve(response);
      }
    });
  });
}

async function saveFingerprintMapping(slotValue, userIdValue) {
  const slot = Number(slotValue);
  const userId = Number(userIdValue);

  if (!Number.isInteger(slot) || slot < 1 || slot > 162 || !userId) {
    throw new Error("Vínculo biométrico inválido");
  }

  return prisma.fingerprint.upsert({
    where: { slot },
    update: { user_id: userId },
    create: { slot, user_id: userId },
  });
}

async function importLocalFingerprintMappings(fingerprints = []) {
  const localMappings = fingerprints.filter(
    (fingerprint) =>
      fingerprint?.mapped === true &&
      Number(fingerprint.slot) > 0 &&
      Number(fingerprint.user_id) > 0,
  );

  if (!localMappings.length) return;

  const userIds = [...new Set(localMappings.map((item) => Number(item.user_id)))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true },
  });
  const existingUserIds = new Set(users.map((user) => user.id));

  const newMappings = localMappings
    .filter((item) => existingUserIds.has(Number(item.user_id)))
    .map((item) => ({
      slot: Number(item.slot),
      user_id: Number(item.user_id),
    }));

  if (newMappings.length) {
    await prisma.fingerprint.createMany({
      data: newMappings,
      skipDuplicates: true,
    });
  }
}

async function reconcileFingerprintMappings(socket = espSocket) {
  const sensorState = await emitCommand(socket, "list-fp");
  const sensorFingerprints = Array.isArray(sensorState?.fingerprints)
    ? sensorState.fingerprints
    : [];

  // Primeiro importa o mapa antigo do ESP para não perdê-lo na implantação.
  await importLocalFingerprintMappings(sensorFingerprints);

  const storedMappings = await prisma.fingerprint.findMany({
    orderBy: { slot: "asc" },
    select: { slot: true, user_id: true },
  });

  await emitCommand(socket, "sync-fp-map", { mappings: storedMappings });

  const mappingsBySlot = new Map(
    storedMappings.map((mapping) => [mapping.slot, mapping.user_id]),
  );

  return {
    ...sensorState,
    fingerprints: sensorFingerprints.map((fingerprint) => {
      const userId = mappingsBySlot.get(Number(fingerprint.slot));
      return {
        ...fingerprint,
        mapped: Boolean(userId),
        user_id: userId || null,
      };
    }),
    mappings_synced: storedMappings.length,
  };
}

/**
 * Inicializa o namespace /esp no socket.io para comunicação com o ESP32.
 * @param {import("socket.io").Server} io
 */
function init(io) {
  const espNamespace = io.of("/esp");

  espNamespace.use((socket, next) => {
    const key = socket.handshake.auth?.key;
    const deviceId = socket.handshake.auth?.device_id || "unknown";
    logger.info(`ESP auth attempt device=${deviceId} match=${key === DOOR_KEY}`);
    if (key === DOOR_KEY) {
      logger.info(`ESP auth success device=${deviceId} socket=${socket.id}`);
      next();
    } else {
      logger.warn(`ESP connection rejected device=${deviceId}: invalid key`);
      next(new Error("Authentication failed"));
    }
  });

  espNamespace.on("connection", (socket) => {
    const deviceId = socket.handshake.auth?.device_id || "unknown";
    logger.info(`ESP32 connected device=${deviceId} socket=${socket.id}`);

    // Se já tem um ESP conectado, desconecta o antigo
    if (espSocket && espSocket.connected) {
      logger.warn(`Replacing previous ESP connection: ${espSocket.id}`);
      espSocket.disconnect(true);
    }

    espSocket = socket;

    socket.on("disconnect", (reason) => {
      logger.info(`ESP32 disconnected: ${reason}`);
      if (espSocket?.id === socket.id) {
        espSocket = null;
      }
    });

    socket.on("fingerprint:enrolled", async (data = {}) => {
      try {
        await saveFingerprintMapping(data.slot, data.user_id);
        logger.info(
          `Fingerprint saved slot=${data.slot} user=${data.user_id} device=${deviceId}`,
        );
      } catch (error) {
        logger.error(`Failed to save fingerprint mapping: ${error.message}`);
      }
    });

    socket.on("fingerprint:deleted", async (data = {}) => {
      try {
        await prisma.fingerprint.deleteMany({
          where: { slot: Number(data.slot) },
        });
        logger.info(`Fingerprint deleted slot=${data.slot} device=${deviceId}`);
      } catch (error) {
        logger.error(`Failed to delete fingerprint mapping: ${error.message}`);
      }
    });

    socket.on("fingerprint:cleared", async () => {
      try {
        await prisma.fingerprint.deleteMany();
        logger.info(`Fingerprint mappings cleared device=${deviceId}`);
      } catch (error) {
        logger.error(`Failed to clear fingerprint mappings: ${error.message}`);
      }
    });

    reconcileFingerprintMappings(socket)
      .then((state) =>
        logger.info(
          `Fingerprint map synchronized device=${deviceId} mappings=${state.mappings_synced}`,
        ),
      )
      .catch((error) =>
        logger.error(
          `Initial fingerprint synchronization failed device=${deviceId}: ${error.message}`,
        ),
      );
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
  return emitCommand(espSocket, action, payload);
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
    deviceId: espSocket.handshake.auth?.device_id || null,
    ip: espSocket.handshake.auth?.ip || null,
  };
}

module.exports = {
  init,
  sendCommand,
  isConnected,
  getStatus,
  reconcileFingerprintMappings,
  saveFingerprintMapping,
};
