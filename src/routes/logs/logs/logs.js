const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { startOfDay, endOfDay } = require("date-fns");
const { toZonedTime, fromZonedTime } = require("date-fns-tz");

const { dateFormat } = require("../../../helpers");
const io = require("../../../../app");
const verifyUser = require("../../auth/auth/utils/auth");

const prisma = new PrismaClient();
const TIMEZONE = "America/Sao_Paulo";
const LOG_INCLUDE = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      picture: true,
    },
  },
  rfid: true,
};

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

router.get("/user/:userId/summary", async (req, res) => {
  const userId = Number(req.params.userId);

  if (!userId) {
    return res.status(400).json({ success: false, error: "userId is required" });
  }

  try {
    const { isVerify, isSuper } = await verifyUser.verifyUser(req.user);
    if (!isVerify || (!isSuper && req.user.id !== userId)) {
      return res
        .status(403)
        .json({ success: false, error: "User no have permision" });
    }

    const baseWhere = {
      user_id: userId,
      type: "ACCESS_GRANTED",
    };

    const [totalAccess, biometricAccess, rfidAccess, frontendAccess, lastAccess] =
      await Promise.all([
        prisma.logs.count({ where: baseWhere }),
        prisma.logs.count({
          where: {
            ...baseWhere,
            message: { contains: "biometria", mode: "insensitive" },
          },
        }),
        prisma.logs.count({
          where: {
            ...baseWhere,
            OR: [
              { rfid_id: { not: null } },
              { message: { contains: "RFID", mode: "insensitive" } },
            ],
          },
        }),
        prisma.logs.count({
          where: {
            ...baseWhere,
            message: { contains: "frontend", mode: "insensitive" },
          },
        }),
        prisma.logs.findFirst({
          where: baseWhere,
          orderBy: { date: "desc" },
          select: { id: true, type: true, message: true, date: true },
        }),
      ]);

    res.status(200).json({
      success: true,
      data: {
        totalAccess,
        biometricAccess,
        rfidAccess,
        frontendAccess,
        lastAccess: lastAccess
          ? { ...lastAccess, date: dateFormat(lastAccess.date) }
          : null,
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
      include: LOG_INCLUDE,
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
    // Compatibilidade com firmwares antigos que mandavam o id da biometria no texto.
    if (!user_id) {
      const bioMatch = message.match(/biometria.*\bid=(\d+)/i);
      if (bioMatch) {
        user_id = bioMatch[1];
      }
    }

    // Fallback do evento WebSocket: persiste o vínculo pelo log de conclusão.
    const enrollmentMatch = message.match(/biometria cadastrada slot=(\d+)/i);
    if (enrollmentMatch && user_id) {
      const slot = Number(enrollmentMatch[1]);
      await prisma.fingerprint.upsert({
        where: { slot },
        update: { user_id: Number(user_id) },
        create: { slot, user_id: Number(user_id) },
      });
    }

    // Se não foi informado rfid_id, tenta extrair o código RFID da mensagem.
    if (!rfid_id && !user_id) {
      const rfidMatch = message.match(/\b([A-Fa-f0-9]{8,})\b/);
      if (rfidMatch) {
        const rfidCode = rfidMatch[1];
        const tag = await prisma.rfidTag.findUnique({
          where: { rfid: rfidCode },
          select: { id: true, user_id: true },
        });
        if (tag) {
          rfid_id = tag.id;
          if (tag.user_id) {
            user_id = tag.user_id;
          }
        }
      }
    }

    if (rfid_id && type === "ACCESS_GRANTED") {
      await prisma.rfidTag.update({
        where: { id: Number(rfid_id) },
        data: {
          last_time_used: new Date(),
          used_times: { increment: 1 },
        },
      });
    }

    const log = await prisma.logs.create({
      data: {
        type,
        message,
        ...(user_id && { user_id: Number(user_id) }),
        ...(rfid_id && { rfid_id: Number(rfid_id) }),
      },
      include: LOG_INCLUDE,
    });

    io.io.emit("logs", { data: log });
  } catch (error) {
    console.error("Erro ao processar log:", error.message);
  }
});

router.get("/logs/user/:userId", async (req, res) => {
  const userId = Number(req.params.userId);

  if (!userId) {
    return res.status(400).json({ success: false, error: "userId is required" });
  }

  try {
    // Cada usuário só vê os próprios registros; admin vê os de qualquer um.
    const { isVerify, isSuper } = await verifyUser.verifyUser(req.user);
    if (!isVerify || (!isSuper && req.user.id !== userId)) {
      return res
        .status(403)
        .json({ success: false, error: "User no have permision" });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const logs = await prisma.logs.findMany({
      where: {
        user_id: userId,
      },
      orderBy: {
        date: "desc",
      },
      take: limit,
      include: LOG_INCLUDE,
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
      include: LOG_INCLUDE,
    });
    io.io.emit("logs", { data: log });
  } catch (error) {
    console.error("Error creating user log:", error.message);
  }
}

module.exports = { router, userLog };
