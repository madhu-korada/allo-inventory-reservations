import { ZodError } from "zod";
import { ReservationDomainError, type ReservationRecord } from "./reservations";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export function jsonResponse<T>(body: T, status = 200) {
  return Response.json(body, { status });
}

export function reservationToJson(reservation: ReservationRecord) {
  return {
    ...reservation,
    expiresAt: reservation.expiresAt.toISOString(),
    confirmedAt: reservation.confirmedAt?.toISOString() ?? null,
    releasedAt: reservation.releasedAt?.toISOString() ?? null,
  };
}

export function errorResponse(error: unknown) {
  if (error instanceof ReservationDomainError) {
    return jsonResponse<ApiErrorBody>(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      error.statusCode,
    );
  }

  if (error instanceof ZodError) {
    return jsonResponse<ApiErrorBody>(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues[0]?.message ?? "Invalid request body.",
        },
      },
      400,
    );
  }

  console.error(error);

  return jsonResponse<ApiErrorBody>(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong.",
      },
    },
    500,
  );
}
