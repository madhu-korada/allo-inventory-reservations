import { Prisma, type PrismaClient } from "@prisma/client";
import {
  type ConfirmResult,
  type ReservationRecord,
  type ReservationStore,
} from "./reservations";

type Transaction = Prisma.TransactionClient;

type StockRow = {
  id: string;
};

type PrismaReservation = {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "RELEASED";
  expiresAt: Date;
  confirmedAt: Date | null;
  releasedAt: Date | null;
};

function toReservationRecord(reservation: PrismaReservation): ReservationRecord {
  return {
    id: reservation.id,
    productId: reservation.productId,
    warehouseId: reservation.warehouseId,
    quantity: reservation.quantity,
    status: reservation.status,
    expiresAt: reservation.expiresAt,
    confirmedAt: reservation.confirmedAt,
    releasedAt: reservation.releasedAt,
  };
}

async function releasePendingInTransaction(
  tx: Transaction,
  reservation: PrismaReservation,
  now: Date,
) {
  const releaseAttempt = await tx.reservation.updateMany({
    where: {
      id: reservation.id,
      status: "PENDING",
    },
    data: {
      status: "RELEASED",
      releasedAt: now,
    },
  });

  if (releaseAttempt.count === 0) {
    const current = await tx.reservation.findUniqueOrThrow({
      where: { id: reservation.id },
    });
    return toReservationRecord(current);
  }

  await tx.stockLevel.update({
    where: {
      productId_warehouseId: {
        productId: reservation.productId,
        warehouseId: reservation.warehouseId,
      },
    },
    data: {
      reservedUnits: {
        decrement: reservation.quantity,
      },
    },
  });

  const released = await tx.reservation.findUniqueOrThrow({
    where: { id: reservation.id },
  });

  return toReservationRecord(released);
}

export function createPrismaReservationStore(
  prisma: PrismaClient,
): ReservationStore {
  return {
    async createPendingReservation(input) {
      return prisma.$transaction(async (tx) => {
        const updatedStock = await tx.$queryRaw<StockRow[]>(Prisma.sql`
          UPDATE "StockLevel"
          SET "reservedUnits" = "reservedUnits" + ${input.quantity},
              "updatedAt" = NOW()
          WHERE "productId" = ${input.productId}
            AND "warehouseId" = ${input.warehouseId}
            AND ("totalUnits" - "reservedUnits") >= ${input.quantity}
          RETURNING "id";
        `);

        if (updatedStock.length === 0) {
          return null;
        }

        const reservation = await tx.reservation.create({
          data: {
            productId: input.productId,
            warehouseId: input.warehouseId,
            quantity: input.quantity,
            status: "PENDING",
            expiresAt: input.expiresAt,
          },
        });

        return toReservationRecord(reservation);
      });
    },

    async confirmReservation(id, now): Promise<ConfirmResult> {
      return prisma.$transaction(async (tx) => {
        const reservation = await tx.reservation.findUnique({
          where: { id },
        });

        if (!reservation) {
          return { kind: "not-found" };
        }

        const snapshot = toReservationRecord(reservation);

        if (reservation.status === "CONFIRMED") {
          return { kind: "confirmed", reservation: snapshot };
        }

        if (reservation.status === "RELEASED" && reservation.expiresAt <= now) {
          return { kind: "expired" };
        }

        if (reservation.status === "RELEASED") {
          return { kind: "released", reservation: snapshot };
        }

        if (reservation.expiresAt <= now) {
          await releasePendingInTransaction(tx, reservation, now);
          return { kind: "expired" };
        }

        const confirmAttempt = await tx.reservation.updateMany({
          where: {
            id,
            status: "PENDING",
            expiresAt: {
              gt: now,
            },
          },
          data: {
            status: "CONFIRMED",
            confirmedAt: now,
          },
        });

        if (confirmAttempt.count === 0) {
          const current = await tx.reservation.findUniqueOrThrow({
            where: { id },
          });

          if (current.status === "CONFIRMED") {
            return {
              kind: "confirmed",
              reservation: toReservationRecord(current),
            };
          }

          if (current.status === "RELEASED" && current.expiresAt > now) {
            return {
              kind: "released",
              reservation: toReservationRecord(current),
            };
          }

          if (current.status === "RELEASED" || current.expiresAt <= now) {
            return { kind: "expired" };
          }

          return { kind: "not-found" };
        }

        await tx.stockLevel.update({
          where: {
            productId_warehouseId: {
              productId: reservation.productId,
              warehouseId: reservation.warehouseId,
            },
          },
          data: {
            totalUnits: {
              decrement: reservation.quantity,
            },
            reservedUnits: {
              decrement: reservation.quantity,
            },
          },
        });

        const confirmed = await tx.reservation.findUniqueOrThrow({
          where: { id },
        });

        return {
          kind: "confirmed",
          reservation: toReservationRecord(confirmed),
        };
      });
    },

    async releaseReservation(id, now) {
      return prisma.$transaction(async (tx) => {
        const reservation = await tx.reservation.findUnique({
          where: { id },
        });

        if (!reservation) {
          return null;
        }

        if (reservation.status !== "PENDING") {
          return toReservationRecord(reservation);
        }

        return releasePendingInTransaction(tx, reservation, now);
      });
    },

    async cleanupExpired(now) {
      return prisma.$transaction(async (tx) => {
        const expired = await tx.reservation.findMany({
          where: {
            status: "PENDING",
            expiresAt: {
              lte: now,
            },
          },
        });

        for (const reservation of expired) {
          await releasePendingInTransaction(tx, reservation, now);
        }

        return expired.length;
      });
    },
  };
}
