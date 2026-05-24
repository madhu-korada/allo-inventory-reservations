import { createHash } from "node:crypto";

export type ReservationStatus = "PENDING" | "CONFIRMED" | "RELEASED";

export type ReservationRecord = {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt: Date;
  confirmedAt: Date | null;
  releasedAt: Date | null;
};

export type ReserveInput = {
  productId: string;
  warehouseId: string;
  quantity: number;
};

export type ConfirmResult =
  | { kind: "confirmed"; reservation: ReservationRecord }
  | { kind: "released"; reservation: ReservationRecord }
  | { kind: "expired" }
  | { kind: "not-found" };

export type ReservationStore = {
  createPendingReservation(input: ReserveInput & { expiresAt: Date }): Promise<ReservationRecord | null>;
  confirmReservation(id: string, now: Date): Promise<ConfirmResult>;
  releaseReservation(id: string, now: Date): Promise<ReservationRecord | null>;
  cleanupExpired(now: Date): Promise<number>;
};

export class ReservationDomainError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReservationDomainError";
  }
}

export const reserveStockSql = `
UPDATE "StockLevel"
SET "reservedUnits" = "reservedUnits" + $3,
    "updatedAt" = NOW()
WHERE "productId" = $1
  AND "warehouseId" = $2
  AND ("totalUnits" - "reservedUnits") >= $3
RETURNING "id";
`.trim();

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function createRequestHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function createReservationService({
  store,
  now = () => new Date(),
  ttlMs = DEFAULT_TTL_MS,
}: {
  store: ReservationStore;
  now?: () => Date;
  ttlMs?: number;
}) {
  return {
    async reserve(input: ReserveInput) {
      if (input.quantity < 1 || !Number.isInteger(input.quantity)) {
        throw new ReservationDomainError(
          400,
          "INVALID_QUANTITY",
          "Quantity must be a positive whole number.",
        );
      }

      const currentTime = now();
      const expiresAt = new Date(currentTime.getTime() + ttlMs);
      const reservation = await store.createPendingReservation({
        ...input,
        expiresAt,
      });

      if (!reservation) {
        throw new ReservationDomainError(
          409,
          "INSUFFICIENT_STOCK",
          "There is not enough available stock to reserve those units.",
        );
      }

      return reservation;
    },

    async confirm(id: string) {
      const result = await store.confirmReservation(id, now());

      if (result.kind === "expired") {
        throw new ReservationDomainError(
          410,
          "RESERVATION_EXPIRED",
          "This reservation has expired and the stock was released.",
        );
      }

      if (result.kind === "not-found") {
        throw new ReservationDomainError(
          404,
          "RESERVATION_NOT_FOUND",
          "Reservation not found.",
        );
      }

      return result.reservation;
    },

    async release(id: string) {
      const reservation = await store.releaseReservation(id, now());

      if (!reservation) {
        throw new ReservationDomainError(
          404,
          "RESERVATION_NOT_FOUND",
          "Reservation not found.",
        );
      }

      return reservation;
    },

    cleanupExpired(nowOverride = now()) {
      return store.cleanupExpired(nowOverride);
    },
  };
}
