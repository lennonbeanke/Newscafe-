"use client";

import { useParams } from "next/navigation";
import { AdminPage } from "@/components/admin/AdminPage";
import { ReservationDetail } from "@/components/admin/reservations/ReservationDetail";

/** One booking: details, status changes, edit and move (owner only). The id is checked to be a UUID before anything is requested. */
export default function AdminReservation() {
  const params = useParams<{ id: string }>();
  return (
    <AdminPage>
      <ReservationDetail id={typeof params.id === "string" ? params.id : ""} />
    </AdminPage>
  );
}
