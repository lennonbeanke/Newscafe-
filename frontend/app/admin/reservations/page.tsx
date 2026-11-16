"use client";

import { AdminPage } from "@/components/admin/AdminPage";
import { ReservationsList } from "@/components/admin/reservations/ReservationsList";

/** Search and filter every booking (owner only). */
export default function AdminReservations() {
  return (
    <AdminPage>
      <ReservationsList />
    </AdminPage>
  );
}
