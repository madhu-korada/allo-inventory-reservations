"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Package,
  RefreshCw,
  Warehouse,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type WarehouseStock = {
  warehouseId: string;
  code: string;
  name: string;
  city: string;
  totalUnits: number;
  reservedUnits: number;
  availableUnits: number;
};

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  warehouses: WarehouseStock[];
};

type Reservation = {
  id: string;
  productId: string;
  warehouseId: string;
  productName?: string;
  productSku?: string;
  warehouseName?: string;
  warehouseCode?: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "RELEASED";
  expiresAt: string;
  confirmedAt: string | null;
  releasedAt: string | null;
};

type ApiError = {
  error?: {
    code: string;
    message: string;
  };
};

function formatCountdown(ms: number) {
  const safeMs = Math.max(0, ms);
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ApiError;
  return body.error?.message ?? `Request failed with ${response.status}`;
}

export function InventoryApp() {
  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  async function loadProducts() {
    const response = await fetch("/api/products", { cache: "no-store" });
    if (!response.ok) throw new Error(await readError(response));
    const body = (await response.json()) as { products: Product[] };
    setProducts(body.products);
  }

  async function loadReservation(id: string) {
    const response = await fetch(`/api/reservations/${id}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await readError(response));
    const body = (await response.json()) as { reservation: Reservation };
    setReservation(body.reservation);
  }

  useEffect(() => {
    // The product table is client-loaded so reservations can refresh it without a page navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProducts()
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const countdownMs = useMemo(() => {
    if (!reservation) return 0;
    return new Date(reservation.expiresAt).getTime() - now;
  }, [now, reservation]);

  async function reserve(product: Product, warehouse: WarehouseStock) {
    const key = `${product.id}:${warehouse.warehouseId}`;
    const quantity = quantities[key] ?? 1;
    setBusyKey(key);
    setMessage(null);

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          warehouseId: warehouse.warehouseId,
          quantity,
        }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const body = (await response.json()) as { reservation: Reservation };
      await Promise.all([loadProducts(), loadReservation(body.reservation.id)]);
      setMessage("Reservation created. Complete checkout before the timer expires.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reserve stock.");
    } finally {
      setBusyKey(null);
    }
  }

  async function mutateReservation(action: "confirm" | "release") {
    if (!reservation) return;
    setBusyKey(action);
    setMessage(null);

    try {
      const response = await fetch(`/api/reservations/${reservation.id}/${action}`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      await Promise.all([loadProducts(), loadReservation(reservation.id)]);
      setMessage(
        action === "confirm"
          ? "Purchase confirmed. Stock has been permanently decremented."
          : "Reservation cancelled. Stock is available again.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update reservation.");
      await Promise.allSettled([loadProducts(), loadReservation(reservation.id)]);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-[#172033]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-[#0f6bff] text-white">
              <Package size={21} strokeWidth={2.3} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">Allo Inventory</h1>
              <p className="text-sm text-slate-500">Reservations for multi-warehouse checkout</p>
            </div>
          </div>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              loadProducts()
                .catch((error: Error) => setMessage(error.message))
                .finally(() => setLoading(false));
            }}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[1fr_360px]">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">Products</h2>
              <p className="text-sm text-slate-500">Available stock is total minus active reservations.</p>
            </div>
          </div>

          {message ? (
            <div className="mx-5 mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 shrink-0" size={16} />
              <span>{message}</span>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                  <th className="px-5 py-3">Product</th>
                  <th className="px-5 py-3">Warehouse</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3 text-right">Reserved</th>
                  <th className="px-5 py-3 text-right">Available</th>
                  <th className="px-5 py-3">Qty</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-5 py-8 text-sm text-slate-500" colSpan={7}>
                      Loading inventory...
                    </td>
                  </tr>
                ) : null}

                {!loading && products.length === 0 ? (
                  <tr>
                    <td className="px-5 py-8 text-sm text-slate-500" colSpan={7}>
                      No seed data found. Run the database seed command.
                    </td>
                  </tr>
                ) : null}

                {products.flatMap((product) =>
                  product.warehouses.map((warehouse, index) => {
                    const key = `${product.id}:${warehouse.warehouseId}`;
                    const quantity = quantities[key] ?? 1;
                    const disabled = warehouse.availableUnits < quantity || busyKey === key;

                    return (
                      <tr key={key} className="align-top hover:bg-slate-50/70">
                        <td className="px-5 py-4">
                          {index === 0 ? (
                            <div>
                              <div className="font-medium text-slate-950">{product.name}</div>
                              <div className="mt-1 text-xs font-medium text-slate-500">{product.sku}</div>
                              <div className="mt-1 max-w-sm text-sm text-slate-500">{product.description}</div>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-2">
                            <Warehouse className="mt-0.5 text-slate-400" size={16} />
                            <div>
                              <div className="text-sm font-medium text-slate-900">{warehouse.code}</div>
                              <div className="text-sm text-slate-500">{warehouse.city}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right text-sm tabular-nums">{warehouse.totalUnits}</td>
                        <td className="px-5 py-4 text-right text-sm tabular-nums">{warehouse.reservedUnits}</td>
                        <td className="px-5 py-4 text-right">
                          <span
                            className={`inline-flex min-w-12 justify-center rounded-md px-2 py-1 text-sm font-semibold tabular-nums ${
                              warehouse.availableUnits > 0
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {warehouse.availableUnits}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <input
                            className="h-9 w-16 rounded-md border border-slate-200 px-2 text-sm tabular-nums outline-none transition focus:border-[#0f6bff] focus:ring-2 focus:ring-blue-100"
                            min={1}
                            type="number"
                            value={quantity}
                            onChange={(event) =>
                              setQuantities((current) => ({
                                ...current,
                                [key]: Number(event.target.value),
                              }))
                            }
                          />
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            className="h-9 rounded-md bg-[#0f6bff] px-3 text-sm font-semibold text-white transition hover:bg-[#0a55d7] disabled:cursor-not-allowed disabled:bg-slate-300"
                            disabled={disabled}
                            onClick={() => reserve(product, warehouse)}
                          >
                            {busyKey === key ? "Reserving" : "Reserve"}
                          </button>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold">Checkout Reservation</h2>
            <p className="text-sm text-slate-500">Confirm payment before the hold expires.</p>
          </div>

          {reservation ? (
            <div className="space-y-5 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-500">Reservation</div>
                  <div className="mt-1 break-all text-sm font-semibold text-slate-950">{reservation.id}</div>
                </div>
                <StatusBadge status={reservation.status} />
              </div>

              <div className="grid gap-3 text-sm">
                <Detail label="Product" value={reservation.productName ?? reservation.productId} />
                <Detail label="Warehouse" value={reservation.warehouseCode ?? reservation.warehouseId} />
                <Detail label="Quantity" value={String(reservation.quantity)} />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <Clock3 size={16} />
                  Time remaining
                </div>
                <div
                  className={`mt-2 text-4xl font-semibold tabular-nums ${
                    reservation.status === "PENDING" && countdownMs <= 0
                      ? "text-rose-600"
                      : "text-slate-950"
                  }`}
                >
                  {reservation.status === "PENDING" ? formatCountdown(countdownMs) : "--:--"}
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  {reservation.status === "PENDING"
                    ? "Expired confirmations return 410 and release the stock."
                    : "This reservation is no longer pending."}
                </p>
              </div>

              <div className="grid gap-2">
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={reservation.status !== "PENDING" || busyKey === "confirm"}
                  onClick={() => mutateReservation("confirm")}
                >
                  <CheckCircle2 size={17} />
                  Confirm purchase
                </button>
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={reservation.status !== "PENDING" || busyKey === "release"}
                  onClick={() => mutateReservation("release")}
                >
                  <XCircle size={17} />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="p-5 text-sm text-slate-500">
              Reserve stock from any warehouse to open the checkout hold.
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: Reservation["status"] }) {
  const styles = {
    PENDING: "bg-blue-50 text-blue-700",
    CONFIRMED: "bg-emerald-50 text-emerald-700",
    RELEASED: "bg-slate-100 text-slate-600",
  };

  return (
    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${styles[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}
