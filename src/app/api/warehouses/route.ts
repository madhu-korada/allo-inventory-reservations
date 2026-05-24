import { errorResponse, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const warehouses = await prisma.warehouse.findMany({
      orderBy: { code: "asc" },
    });

    return jsonResponse({
      warehouses: warehouses.map((warehouse) => ({
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
        city: warehouse.city,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
