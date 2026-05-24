import { errorResponse, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createPrismaReservationStore } from "@/lib/prisma-reservation-store";
import { createReservationService } from "@/lib/reservations";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const service = createReservationService({
      store: createPrismaReservationStore(prisma),
    });
    await service.cleanupExpired();

    const products = await prisma.product.findMany({
      orderBy: { name: "asc" },
      include: {
        stockLevels: {
          include: {
            warehouse: true,
          },
          orderBy: {
            warehouse: {
              code: "asc",
            },
          },
        },
      },
    });

    return jsonResponse({
      products: products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        warehouses: product.stockLevels.map((stockLevel) => ({
          warehouseId: stockLevel.warehouseId,
          code: stockLevel.warehouse.code,
          name: stockLevel.warehouse.name,
          city: stockLevel.warehouse.city,
          totalUnits: stockLevel.totalUnits,
          reservedUnits: stockLevel.reservedUnits,
          availableUnits: stockLevel.totalUnits - stockLevel.reservedUnits,
        })),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
