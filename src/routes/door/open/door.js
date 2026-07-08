const express = require("express");
const { PrismaClient } = require("@prisma/client");

const verifyUser = require("../../auth/auth/utils/auth");
const logger = require("../../../middlewares/logger/logger");
const espManager = require("../../../services/espManager");
const { userLog } = require("../../logs/logs/logs");

const router = new express.Router();
const prisma = new PrismaClient();

const ensureEspConnected = (res) => {
  if (espManager.isConnected()) {
    return true;
  }
  res.status(503).json({ success: false, error: "ESP32 nao esta conectado" });
  return false;
};

const ensureVerifiedUser = async (req, res) => {
  const { isVerify } = await verifyUser.verifyUser(req.user);
  if (!isVerify) {
    res.status(403).json({ success: false, error: "User no have permision" });
    return false;
  }
  return true;
};

const ensureSuperUser = async (req, res) => {
  const { isVerify, isSuper } = await verifyUser.verifyUser(req.user);
  if (!isVerify || !isSuper) {
    res
      .status(403)
      .json({ success: false, error: "User does not have permission" });
    return false;
  }
  return true;
};

const getNextFingerprintSlot = (fingerprints = []) => {
  const usedSlots = new Set(
    fingerprints
      .map((fingerprint) => Number(fingerprint.slot))
      .filter((slot) => Number.isInteger(slot) && slot > 0),
  );

  for (let slot = 1; slot <= 162; slot += 1) {
    if (!usedSlots.has(slot)) {
      return slot;
    }
  }

  return null;
};

router.get("/open", async (req, res) => {
  try {
    if (!(await ensureVerifiedUser(req, res))) return;
    if (!ensureEspConnected(res)) return;

    logger.info("Opening door via WebSocket");
    const response = await espManager.sendCommand("open-door");
    await userLog(req.user.id, "Porta aberta via frontend", "ACCESS_GRANTED");
    res
      .status(200)
      .json({ success: true, message: "Door opened", data: response });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/mode", async (req, res) => {
  const { mode } = req.body;
  if (typeof mode !== "boolean") {
    return res.status(400).json({ success: false, error: "Mode not found" });
  }

  try {
    if (!(await ensureSuperUser(req, res))) return;
    if (!ensureEspConnected(res)) return;

    logger.info(`Changing mode to ${mode} via WebSocket`);
    const response = await espManager.sendCommand("toggle-mode", { mode });
    const confirmedMode =
      typeof response.registration_mode === "boolean"
        ? response.registration_mode
        : mode;

    await prisma.ip.update({
      where: { id: 1 },
      data: { mode: confirmedMode, updated_at: new Date() },
    });

    res
      .status(200)
      .json({ success: true, data: { ...response, mode: confirmedMode } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get("/mode", async (req, res) => {
  try {
    const { getMode } = require("../../health/heartbeat/utils/health");
    const mode = await getMode();
    if (mode instanceof Error) {
      return res.status(404).json({ success: false, error: mode.message });
    }
    res.status(200).json({ success: true, data: mode });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get("/cache", async (req, res) => {
  try {
    if (!ensureEspConnected(res)) return;

    logger.info("Refreshing ESP cache via WebSocket");
    const response = await espManager.sendCommand("refresh-cache");
    res.status(200).json({ success: true, data: response });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get("/fingerprints/status", async (req, res) => {
  try {
    if (!(await ensureVerifiedUser(req, res))) return;
    if (!ensureEspConnected(res)) return;

    const response = await espManager.sendCommand("fp-status");
    res.status(200).json({ success: true, data: response });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get("/fingerprints", async (req, res) => {
  try {
    if (!(await ensureVerifiedUser(req, res))) return;
    if (!ensureEspConnected(res)) return;

    const response = await espManager.sendCommand("list-fp");
    res.status(200).json({ success: true, data: response });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/fingerprints/enroll", async (req, res) => {
  const userId = Number(req.body.userId);

  if (!userId) {
    return res
      .status(400)
      .json({ success: false, error: "userId is required" });
  }

  try {
    if (!(await ensureSuperUser(req, res))) return;
    if (!ensureEspConnected(res)) return;

    const listResponse = await espManager.sendCommand("list-fp");
    const slot = getNextFingerprintSlot(listResponse.fingerprints);

    if (!slot) {
      return res
        .status(409)
        .json({ success: false, error: "No fingerprint slots available" });
    }

    const response = await espManager.sendCommand("enroll-fp", {
      slot,
      user_id: userId,
    });
    res.status(200).json({ success: true, data: response });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/fingerprints/cancel", async (req, res) => {
  try {
    if (!(await ensureSuperUser(req, res))) return;
    if (!ensureEspConnected(res)) return;

    const response = await espManager.sendCommand("cancel-enroll-fp");
    res.status(200).json({ success: true, data: response });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete("/fingerprints/:slot", async (req, res) => {
  const slot = Number(req.params.slot);

  if (!slot) {
    return res.status(400).json({ success: false, error: "slot is required" });
  }

  try {
    if (!(await ensureSuperUser(req, res))) return;
    if (!ensureEspConnected(res)) return;

    const response = await espManager.sendCommand("delete-fp", { slot });
    res.status(200).json({ success: true, data: response });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/fingerprints/clear", async (req, res) => {
  try {
    if (!(await ensureSuperUser(req, res))) return;
    if (!ensureEspConnected(res)) return;

    const response = await espManager.sendCommand("clear-fp");
    res.status(200).json({ success: true, data: response });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get("/status", async (req, res) => {
  try {
    const status = espManager.getStatus();
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
