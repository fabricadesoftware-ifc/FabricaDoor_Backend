const express = require("express");
const { PrismaClient } = require("@prisma/client");

const verifyUser = require("../../auth/auth/utils/auth");
const logger = require("../../../middlewares/logger/logger");
const espManager = require("../../../services/espManager");

const router = new express.Router();
const prisma = new PrismaClient();

router.get("/open", async (req, res) => {
  const { isVerify } = await verifyUser.verifyUser(req.user);
  if (!isVerify) {
    return res
      .status(403)
      .json({ success: false, error: "User no have permision" });
  }
  try {
    if (!espManager.isConnected()) {
      return res
        .status(503)
        .json({ success: false, error: "ESP32 não está conectado" });
    }
    logger.info("Opening door via WebSocket");
    const response = await espManager.sendCommand("open-door");
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
    const { isVerify, isSuper } = await verifyUser.verifyUser(req.user);

    if (!isVerify || !isSuper) {
      return res.status(403).json({ error: "User does not have permission" });
    }
    if (!espManager.isConnected()) {
      return res
        .status(503)
        .json({ success: false, error: "ESP32 não está conectado" });
    }

    logger.info(`Changing mode to ${mode} via WebSocket`);
    const response = await espManager.sendCommand("toggle-mode", { mode });
    await prisma.ip.update({
      where: { id: 1 },
      data: { mode, updated_at: new Date() },
    });
    res.status(200).json({ success: true, data: { ...response, mode } });
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
    if (!espManager.isConnected()) {
      return res
        .status(503)
        .json({ success: false, error: "ESP32 não está conectado" });
    }
    logger.info("Refreshing ESP cache via WebSocket");
    const response = await espManager.sendCommand("refresh-cache");
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
