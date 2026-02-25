const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { startOfDay, endOfDay } = require("date-fns");
const { toZonedTime, fromZonedTime } = require("date-fns-tz");

const { dateFormat } = require("../../../helpers");
const io = require("../../../../app");
const verifyUser = require("../../auth/auth/utils/auth");

const prisma = new PrismaClient();
const TIMEZONE = "America/Sao_Paulo";

router = new express.Router();

router.get("/today", async (req, res) => {
  try {
    const { isVerify } = await verifyUser.verifyUser(req.user);
    if (!isVerify) {
      return res
        .status(403)
        .json({ success: false, error: "User no have permision" });
    }

    const now = toZonedTime(new Date(), TIMEZONE);
    const dayStart = fromZonedTime(startOfDay(now), TIMEZONE);
    const dayEnd = fromZonedTime(endOfDay(now), TIMEZONE);

    const count = await prisma.logs.count({
      where: {
        date: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
    });

    res.status(200).json({
      success: true,
      data: {
        count,
        date: dateFormat(now),
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const { isVerify } = await verifyUser.verifyUser(req.user);
    if (!isVerify) {
      return res
        .status(403)
        .json({ success: false, error: "User no have permision" });
    }
    let { page, limit, startDate, endDate } = req.query;
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;
    const skip = (page - 1) * limit;

    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter = {
        date: {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        },
      };
    }

    const logs = await prisma.logs.findMany({
      where: dateFilter,
      skip: skip,
      take: limit,
      orderBy: {
        date: "desc",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
        rfid: true,
      },
    });

    logs.forEach((log) => {
      log.date = dateFormat(log.date);
    });

    const totalLogs = await prisma.logs.count({
      where: dateFilter,
    });
    const totalPages = Math.ceil(totalLogs / limit);

    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        totalLogs,
        totalPages,
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/", async (req, res) => {
  let { type, message, user_id, rfid_id } = req.body;
  if (!type || !message) {
    return res.status(400).json({ error: "type and message are required" });
  }

  if (typeof message !== "string") {
    message = JSON.stringify(message);
  }
  res.status(200).json({ success: true, message: "Log is being processed" });

  try {
    const log = await prisma.logs.create({
      data: {
        type,
        message,
        ...(user_id && { user_id: Number(user_id) }),
        ...(rfid_id && { rfid_id: Number(rfid_id) }),
      },
    });

    io.io.emit("logs", { data: log });
  } catch (error) {
    console.error("Erro ao processar log:", error.message);
  }
});

router.get("/logs/user/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const logs = await prisma.logs.findMany({
      where: {
        user_id: Number(userId),
      },
      orderBy: {
        date: "desc",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
        rfid: true,
      },
    });

    logs.forEach((log) => {
      log.date = dateFormat(log.date);
    });

    res.status(200).json({ success: true, data: logs });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

async function userLog(userId, message, type, rfidId) {
  try {
    const log = await prisma.logs.create({
      data: {
        user_id: userId,
        message,
        type,
        ...(rfidId && { rfid_id: rfidId }),
      },
    });
    io.io.emit("logs", { data: log });
  } catch (error) {
    console.error("Error creating user log:", error.message);
  }
}

module.exports = { router, userLog };
