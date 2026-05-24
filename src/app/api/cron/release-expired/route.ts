import { errorResponse, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createPrismaReservationStore } from "@/lib/prisma-reservation-store";
import { createReservationService } from "@/lib/reservations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonResponse(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized.",
        },
      },
      401,
    );
  }

  try {
    const service = createReservationService({
      store: createPrismaReservationStore(prisma),
    });
    const releasedCount = await service.cleanupExpired();

    return jsonResponse({
      releasedCount,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
