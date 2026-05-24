import { errorResponse, reservationToJson } from "@/lib/api";
import { runWithIdempotency } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { createPrismaReservationStore } from "@/lib/prisma-reservation-store";
import { createReservationService } from "@/lib/reservations";
import { reserveRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const rawPayload = await request.json();
    const payload = reserveRequestSchema.parse(rawPayload);

    return await runWithIdempotency({
      prisma,
      method: "POST",
      route: "/api/reservations",
      key: request.headers.get("Idempotency-Key"),
      requestBody: rawPayload,
      run: async () => {
        const service = createReservationService({
          store: createPrismaReservationStore(prisma),
        });
        const reservation = await service.reserve(payload);

        return {
          status: 201,
          body: { reservation: reservationToJson(reservation) },
        };
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
