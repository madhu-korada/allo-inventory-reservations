import { errorResponse, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createPrismaReservationStore } from "@/lib/prisma-reservation-store";
import { createReservationService } from "@/lib/reservations";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const service = createReservationService({
      store: createPrismaReservationStore(prisma),
    });
    await service.cleanupExpired();

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        product: true,
        warehouse: true,
      },
    });

    if (!reservation) {
      return jsonResponse(
        {
          error: {
            code: "RESERVATION_NOT_FOUND",
            message: "Reservation not found.",
          },
        },
        404,
      );
    }

    return jsonResponse({
      reservation: {
        id: reservation.id,
        productId: reservation.productId,
        warehouseId: reservation.warehouseId,
        productName: reservation.product.name,
        productSku: reservation.product.sku,
        warehouseName: reservation.warehouse.name,
        warehouseCode: reservation.warehouse.code,
        quantity: reservation.quantity,
        status: reservation.status,
        expiresAt: reservation.expiresAt.toISOString(),
        confirmedAt: reservation.confirmedAt?.toISOString() ?? null,
        releasedAt: reservation.releasedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
