import { Prisma, type PrismaClient } from "@prisma/client";
import { jsonResponse } from "./api";
import { createRequestHash, ReservationDomainError } from "./reservations";

type IdempotentResult = {
  status: number;
  body: Prisma.InputJsonValue;
};

function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function replayExistingIdempotentResponse({
  prisma,
  method,
  route,
  key,
  requestHash,
}: {
  prisma: PrismaClient;
  method: string;
  route: string;
  key: string;
  requestHash: string;
}) {
  const existing = await prisma.idempotencyRecord.findUnique({
    where: {
      method_route_key: {
        method,
        route,
        key,
      },
    },
  });

  if (!existing) {
    return null;
  }

  if (existing.requestHash !== requestHash) {
    throw new ReservationDomainError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This Idempotency-Key was already used with a different request body.",
    );
  }

  if (existing.statusCode && existing.responseJson !== null) {
    return jsonResponse(existing.responseJson, existing.statusCode);
  }

  throw new ReservationDomainError(
    409,
    "IDEMPOTENCY_REQUEST_IN_PROGRESS",
    "A request with this Idempotency-Key is still being processed.",
  );
}

export async function runWithIdempotency({
  prisma,
  method,
  route,
  key,
  requestBody,
  run,
}: {
  prisma: PrismaClient;
  method: string;
  route: string;
  key: string | null;
  requestBody: unknown;
  run: () => Promise<IdempotentResult>;
}) {
  if (!key) {
    const result = await run();
    return jsonResponse(result.body, result.status);
  }

  const requestHash = createRequestHash(requestBody);
  const replay = await replayExistingIdempotentResponse({
    prisma,
    method,
    route,
    key,
    requestHash,
  });

  if (replay) {
    return replay;
  }

  try {
    await prisma.idempotencyRecord.create({
      data: {
        method,
        route,
        key,
        requestHash,
      },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const replayAfterConflict = await replayExistingIdempotentResponse({
        prisma,
        method,
        route,
        key,
        requestHash,
      });

      if (replayAfterConflict) {
        return replayAfterConflict;
      }
    }

    throw error;
  }

  try {
    const result = await run();
    await prisma.idempotencyRecord.update({
      where: {
        method_route_key: {
          method,
          route,
          key,
        },
      },
      data: {
        statusCode: result.status,
        responseJson: result.body,
      },
    });
    return jsonResponse(result.body, result.status);
  } catch (error) {
    if (error instanceof ReservationDomainError) {
      const body: Prisma.InputJsonObject = {
        error: {
          code: error.code,
          message: error.message,
        },
      };

      await prisma.idempotencyRecord.update({
        where: {
          method_route_key: {
            method,
            route,
            key,
          },
        },
        data: {
          statusCode: error.statusCode,
          responseJson: body,
        },
      });

      return jsonResponse(body, error.statusCode);
    }

    await prisma.idempotencyRecord.delete({
      where: {
        method_route_key: {
          method,
          route,
          key,
        },
      },
    });
    throw error;
  }
}
