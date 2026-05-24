import { errorResponse, jsonResponse, reservationToJson } from "@/lib/api";
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
    const service = createReservationService({
      store: createPrismaReservationStore(prisma),
    });
    const reservation = await service.release(id);

    return jsonResponse({ reservation: reservationToJson(reservation) });
  } catch (error) {
    return errorResponse(error);
  }
}
