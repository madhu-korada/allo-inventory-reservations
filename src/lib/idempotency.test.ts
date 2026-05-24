import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { runWithIdempotency } from "./idempotency";
import { createRequestHash, ReservationDomainError } from "./reservations";

type StoredIdempotencyRecord = {
  method: string;
  route: string;
  key: string;
  requestHash: string;
  statusCode: number | null;
  responseJson: unknown | null;
};

function recordKey(method: string, route: string, key: string) {
  return `${method}:${route}:${key}`;
}

class MemoryIdempotencyRecordDelegate {
  records = new Map<string, StoredIdempotencyRecord>();

  async findUnique({
    where,
  }: {
    where: { method_route_key: { method: string; route: string; key: string } };
  }) {
    const { method, route, key } = where.method_route_key;
    return this.records.get(recordKey(method, route, key)) ?? null;
  }

  async create({
    data,
  }: {
    data: {
      method: string;
      route: string;
      key: string;
      requestHash: string;
    };
  }) {
    const key = recordKey(data.method, data.route, data.key);
    const record = {
      ...data,
      statusCode: null,
      responseJson: null,
    };
    this.records.set(key, record);
    return record;
  }

  async update({
    where,
    data,
  }: {
    where: { method_route_key: { method: string; route: string; key: string } };
    data: { statusCode?: number; responseJson?: unknown };
  }) {
    const { method, route, key } = where.method_route_key;
    const mapKey = recordKey(method, route, key);
    const record = this.records.get(mapKey);
    if (!record) throw new Error("Missing idempotency record");
    const updated = { ...record, ...data };
    this.records.set(mapKey, updated);
    return updated;
  }

  async delete({
    where,
  }: {
    where: { method_route_key: { method: string; route: string; key: string } };
  }) {
    const { method, route, key } = where.method_route_key;
    this.records.delete(recordKey(method, route, key));
  }
}

function fakePrisma(delegate = new MemoryIdempotencyRecordDelegate()) {
  return {
    delegate,
    prisma: {
      idempotencyRecord: delegate,
    } as unknown as PrismaClient,
  };
}

async function readJson(response: Response) {
  return response.json() as Promise<unknown>;
}

describe("runWithIdempotency", () => {
  it("stores and replays the original successful response without rerunning the side effect", async () => {
    const { prisma } = fakePrisma();
    const run = vi.fn(async () => ({
      status: 201,
      body: { reservation: { id: "reservation-1" } },
    }));

    const first = await runWithIdempotency({
      prisma,
      method: "POST",
      route: "/api/reservations",
      key: "reserve-key",
      requestBody: { productId: "p1", warehouseId: "w1", quantity: 1 },
      run,
    });
    const second = await runWithIdempotency({
      prisma,
      method: "POST",
      route: "/api/reservations",
      key: "reserve-key",
      requestBody: { warehouseId: "w1", quantity: 1, productId: "p1" },
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await expect(readJson(second)).resolves.toEqual({
      reservation: { id: "reservation-1" },
    });
  });

  it("rejects a reused key with a different request body", async () => {
    const { prisma } = fakePrisma();

    await runWithIdempotency({
      prisma,
      method: "POST",
      route: "/api/reservations",
      key: "reserve-key",
      requestBody: { productId: "p1", warehouseId: "w1", quantity: 1 },
      run: async () => ({
        status: 201,
        body: { reservation: { id: "reservation-1" } },
      }),
    });

    await expect(
      runWithIdempotency({
        prisma,
        method: "POST",
        route: "/api/reservations",
        key: "reserve-key",
        requestBody: { productId: "p1", warehouseId: "w1", quantity: 2 },
        run: async () => ({
          status: 201,
          body: { reservation: { id: "reservation-2" } },
        }),
      }),
    ).rejects.toMatchObject<Partial<ReservationDomainError>>({
      statusCode: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("rejects a duplicate key while the first request is still in progress", async () => {
    const delegate = new MemoryIdempotencyRecordDelegate();
    const { prisma } = fakePrisma(delegate);
    const requestBody = { reservationId: "reservation-1" };
    delegate.records.set(recordKey("POST", "/confirm", "confirm-key"), {
      method: "POST",
      route: "/confirm",
      key: "confirm-key",
      requestHash: createRequestHash(requestBody),
      statusCode: null,
      responseJson: null,
    });

    await expect(
      runWithIdempotency({
        prisma,
        method: "POST",
        route: "/confirm",
        key: "confirm-key",
        requestBody,
        run: async () => ({
          status: 200,
          body: { reservation: { id: "reservation-1" } },
        }),
      }),
    ).rejects.toMatchObject<Partial<ReservationDomainError>>({
      statusCode: 409,
      code: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
    });
  });

  it("stores domain errors so equivalent retries replay the same failure", async () => {
    const { prisma } = fakePrisma();
    const run = vi.fn(async () => {
      throw new ReservationDomainError(
        410,
        "RESERVATION_EXPIRED",
        "This reservation has expired and the stock was released.",
      );
    });

    const first = await runWithIdempotency({
      prisma,
      method: "POST",
      route: "/confirm",
      key: "confirm-key",
      requestBody: { id: "reservation-1" },
      run,
    });
    const second = await runWithIdempotency({
      prisma,
      method: "POST",
      route: "/confirm",
      key: "confirm-key",
      requestBody: { id: "reservation-1" },
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(410);
    expect(second.status).toBe(410);
    await expect(readJson(second)).resolves.toEqual({
      error: {
        code: "RESERVATION_EXPIRED",
        message: "This reservation has expired and the stock was released.",
      },
    });
  });
});
