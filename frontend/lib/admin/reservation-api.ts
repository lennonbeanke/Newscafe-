// The calls the reservation screens make to the OWNER API (through lib/admin/api.ts, which adds the CSRF header and token).
// Ids are checked to be UUIDs before they are put in a path, so nothing else can ever be requested from here.
import { adminGet, adminPatch, adminPost } from "./api";
import { UUID_RE, type ActionName } from "./reservations";

const idPath = (id: string): string => {
  if (!UUID_RE.test(id)) throw new Error("not a reservation id");
  return `/reservations/${id}`;
};

export const listReservations = (query: Record<string, string | number>, signal?: AbortSignal) =>
  adminGet<{ items: unknown[]; has_more: boolean }>("/reservations", query, signal);
export const getReservation = (id: string, signal?: AbortSignal) => adminGet<{ reservation: unknown }>(idPath(id), {}, signal);
export const listTables = (signal?: AbortSignal) => adminGet<{ items: unknown[] }>("/tables", {}, signal);

export const runAction = (id: string, action: ActionName, reason?: string) =>
  adminPost<{ reservation: unknown }>(`${idPath(id)}/${action}`, action === "cancel" && reason ? { reason } : undefined);
export const editReservation = (id: string, patch: Record<string, string | null>) => adminPatch<{ reservation: unknown }>(idPath(id), patch);
export const moveReservation = (id: string, body: Record<string, string | number>) => adminPost<{ reservation: unknown }>(`${idPath(id)}/move`, body);
