"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { embedReturnPath } from "@/lib/embed";

/**
 * Paying now happens in the event page's Registration card in one tap
 * (components/OneTapCheckout.tsx). Old links land there; the embed pop-up's link goes back to it.
 */
export default function PayRedirect() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  useEffect(() => {
    const back = embedReturnPath(new URLSearchParams(window.location.search).get("returnTo"), id);
    router.replace(back ?? `/e/${id}#registration`);
  }, [id, router]);
  return null;
}
