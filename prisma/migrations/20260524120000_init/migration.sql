CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'RELEASED');

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Warehouse" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockLevel" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "totalUnits" INTEGER NOT NULL,
  "reservedUnits" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Reservation" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "statusCode" INTEGER,
  "responseJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");
CREATE UNIQUE INDEX "StockLevel_productId_warehouseId_key" ON "StockLevel"("productId", "warehouseId");
CREATE INDEX "StockLevel_warehouseId_idx" ON "StockLevel"("warehouseId");
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");
CREATE INDEX "Reservation_productId_warehouseId_idx" ON "Reservation"("productId", "warehouseId");
CREATE UNIQUE INDEX "IdempotencyRecord_method_route_key_key" ON "IdempotencyRecord"("method", "route", "key");

ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
