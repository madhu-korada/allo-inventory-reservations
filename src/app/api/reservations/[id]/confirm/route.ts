import { errorResponse, reservationToJson } from "@/lib/api";
import { runWithIdempotency } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { createPrismaReservationStore } from "@/lib/prisma-reservation-store";
import { createReservationService } from "@/lib/reservations";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return await runWithIdempotency({
      prisma,
      method: "POST",
      route: `/api/reservations/${id}/confirm`,
      key: _request.headers.get("Idempotency-Key"),
      requestBody: { id },
      run: async () => {
        const service = createReservationService({
          store: createPrismaReservationStore(prisma),
        });
        const reservation = await service.confirm(id);

        return {
          status: 200,
          body: { reservation: reservationToJson(reservation) },
        };
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
