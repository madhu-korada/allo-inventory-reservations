import { describe, expect, it } from "vitest";
import {
  ReservationDomainError,
  createReservationService,
  createRequestHash,
  reserveStockSql,
  type ReservationRecord,
  type ReservationStore,
} from "./reservations";

class MemoryStore implements ReservationStore {
  private stock = new Map<string, { totalUnits: number; reservedUnits: number }>();
  private reservations = new Map<string, ReservationRecord>();
  private nextId = 1;

  setStock(productId: string, warehouseId: string, totalUnits: number) {
    this.stock.set(`${productId}:${warehouseId}`, { totalUnits, reservedUnits: 0 });
  }

  async createPendingReservation(input: {
    productId: string;
    warehouseId: string;
    quantity: number;
    expiresAt: Date;
  }) {
    const key = `${input.productId}:${input.warehouseId}`;
    const level = this.stock.get(key);

    if (!level || level.totalUnits - level.reservedUnits < input.quantity) {
      return null;
    }

    level.reservedUnits += input.quantity;

    const reservation: ReservationRecord = {
      id: `reservation-${this.nextId++}`,
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      status: "PENDING",
      expiresAt: input.expiresAt,
      confirmedAt: null,
      releasedAt: null,
    };

    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  async confirmReservation(id: string, now: Date) {
    const reservation = this.reservations.get(id);
    if (!reservation) return { kind: "not-found" as const };
    if (reservation.status === "CONFIRMED") {
      return { kind: "confirmed" as const, reservation };
    }
    if (reservation.status === "RELEASED") {
      return { kind: "released" as const, reservation };
    }
    if (reservation.expiresAt <= now) {
      await this.releaseReservation(id, now);
      return { kind: "expired" as const };
    }

    const key = `${reservation.productId}:${reservation.warehouseId}`;
    const level = this.stock.get(key);
    if (level) {
      level.totalUnits -= reservation.quantity;
      level.reservedUnits -= reservation.quantity;
    }

    reservation.status = "CONFIRMED";
    reservation.confirmedAt = now;
    return { kind: "confirmed" as const, reservation };
  }

  async releaseReservation(id: string, now: Date) {
    const reservation = this.reservations.get(id);
    if (!reservation) return null;
    if (reservation.status !== "PENDING") return reservation;

    const key = `${reservation.productId}:${reservation.warehouseId}`;
    const level = this.stock.get(key);
    if (level) {
      level.reservedUnits -= reservation.quantity;
    }

    reservation.status = "RELEASED";
    reservation.releasedAt = now;
    return reservation;
  }

  async cleanupExpired() {
    return 0;
  }
}

describe("reservation service", () => {
  it("creates a pending reservation with a ten minute expiry", async () => {
    const store = new MemoryStore();
    const now = new Date("2026-05-24T10:00:00.000Z");
    store.setStock("product-1", "warehouse-1", 2);

    const service = createReservationService({
      store,
      now: () => now,
      ttlMs: 10 * 60 * 1000,
    });

    const reservation = await service.reserve({
      productId: "product-1",
      warehouseId: "warehouse-1",
      quantity: 1,
    });

    expect(reservation.status).toBe("PENDING");
    expect(reservation.expiresAt.toISOString()).toBe("2026-05-24T10:10:00.000Z");
  });

  it("returns a 409 domain error when stock is unavailable", async () => {
    const store = new MemoryStore();
    const service = createReservationService({
      store,
      now: () => new Date("2026-05-24T10:00:00.000Z"),
    });

    await expect(
      service.reserve({
        productId: "product-1",
        warehouseId: "warehouse-1",
        quantity: 1,
      }),
    ).rejects.toMatchObject<Partial<ReservationDomainError>>({
      statusCode: 409,
      code: "INSUFFICIENT_STOCK",
    });
  });

  it("returns a 410 domain error and releases the hold when confirming an expired reservation", async () => {
    const store = new MemoryStore();
    const start = new Date("2026-05-24T10:00:00.000Z");
    store.setStock("product-1", "warehouse-1", 1);

    const service = createReservationService({
      store,
      now: () => start,
      ttlMs: 60_000,
    });

    const reservation = await service.reserve({
      productId: "product-1",
      warehouseId: "warehouse-1",
      quantity: 1,
    });

    const afterExpiry = new Date("2026-05-24T10:02:00.000Z");
    const expiredService = createReservationService({
      store,
      now: () => afterExpiry,
      ttlMs: 60_000,
    });

    await expect(expiredService.confirm(reservation.id)).rejects.toMatchObject<
      Partial<ReservationDomainError>
    >({
      statusCode: 410,
      code: "RESERVATION_EXPIRED",
    });

    await expect(
      expiredService.reserve({
        productId: "product-1",
        warehouseId: "warehouse-1",
        quantity: 1,
      }),
    ).resolves.toMatchObject({ status: "PENDING" });
  });
});

describe("postgres reservation SQL", () => {
  it("increments reserved units only when enough stock is still available", () => {
    expect(reserveStockSql).toContain(
      '("totalUnits" - "reservedUnits") >= $3',
    );
    expect(reserveStockSql).toContain(
      '"reservedUnits" = "reservedUnits" + $3',
    );
  });
});

describe("idempotency request hashing", () => {
  it("returns the same hash for equivalent JSON bodies", () => {
    expect(createRequestHash({ productId: "p1", quantity: 1 })).toBe(
      createRequestHash({ quantity: 1, productId: "p1" }),
    );
  });

  it("returns different hashes for different JSON bodies", () => {
    expect(createRequestHash({ productId: "p1", quantity: 1 })).not.toBe(
      createRequestHash({ productId: "p1", quantity: 2 }),
    );
  });
});
