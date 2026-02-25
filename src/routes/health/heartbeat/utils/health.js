const { PrismaClient } = require("@prisma/client");

const { HealthError, ValidationError } = require("../../../../helpers");
const NodeCache = require("node-cache");
const { logger } = require("../../../../middlewares");

const cache = new NodeCache({ stdTTL: 864000, checkperiod: 1800 });

const prisma = new PrismaClient();

async function checkHealth() {
  try {
    await prisma.$connect();
    await prisma.$disconnect();
    return "OK";
  } catch (error) {
    return new HealthError(`Health check failed: ${error.message}`);
  }
}

async function checkIp(ip) {
  if (!ip) {
    return new ValidationError("Ip is required");
  }
  try {
    await prisma.ip.update({
      where: {
        id: 1,
      },
      data: {
        ip: ip,
        updated_at: new Date(),
      },
    });
  } catch (error) {
    console.error(error);
    return new HealthError(`Ip check failed: ${error.message}`);
  }
}

async function getIp(req) {
  try {
    const ip = await prisma.ip.findFirst();

    if (!ip) {
      return new HealthError("Ip not found");
    }

    return ip.ip;
  } catch (error) {
    console.error(error);
    return new HealthError(`Ip check failed: ${error.message}`);
  }
}

async function getMode() {
  try {
    const mode = await prisma.ip.findFirst({
      where: {
        id: 1,
      },
    });
    if (!mode) {
      return new HealthError("Mode not found");
    }
    return mode.mode;
  } catch (error) {
    console.error(error);
    return new HealthError(`Mode check failed: ${error.message}`);
  }
}

async function updateCache() {
  try {
    const espManager = require("../../../../services/espManager");
    if (!espManager.isConnected()) {
      return new HealthError("ESP32 não está conectado");
    }
    const response = await espManager.sendCommand("refresh-cache");
    return response;
  } catch (error) {
    return new HealthError(`Cache update failed: ${error.message}`);
  }
}

module.exports = { checkHealth, checkIp, getIp, updateCache, getMode };
