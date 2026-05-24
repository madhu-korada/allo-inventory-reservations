import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  {
    sku: "ALLO-CALM-30",
    name: "Calm Capsules",
    description: "Daily wellness capsules for subscription and D2C orders.",
  },
  {
    sku: "ALLO-RESTORE-15",
    name: "Restore Sachets",
    description: "Fast-moving replenishment sachets sold in 15-count boxes.",
  },
  {
    sku: "ALLO-CARE-KIT",
    name: "Care Starter Kit",
    description: "Bundled starter kit with limited launch inventory.",
  },
];

const warehouses = [
  { code: "BLR", name: "Bengaluru Fulfillment", city: "Bengaluru" },
  { code: "DEL", name: "Delhi NCR Hub", city: "Delhi NCR" },
  { code: "MUM", name: "Mumbai West Hub", city: "Mumbai" },
];

async function main() {
  await prisma.reservation.deleteMany();
  await prisma.stockLevel.deleteMany();
  await prisma.product.deleteMany();
  await prisma.warehouse.deleteMany();

  const savedProducts = await Promise.all(
    products.map((product) =>
      prisma.product.create({
        data: product,
      }),
    ),
  );

  const savedWarehouses = await Promise.all(
    warehouses.map((warehouse) =>
      prisma.warehouse.create({
        data: warehouse,
      }),
    ),
  );

  const matrix = [
    [12, 6, 3],
    [8, 0, 5],
    [1, 2, 0],
  ];

  for (const [productIndex, product] of savedProducts.entries()) {
    for (const [warehouseIndex, warehouse] of savedWarehouses.entries()) {
      await prisma.stockLevel.create({
        data: {
          productId: product.id,
          warehouseId: warehouse.id,
          totalUnits: matrix[productIndex][warehouseIndex],
        },
      });
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
