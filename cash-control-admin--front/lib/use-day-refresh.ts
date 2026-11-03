"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { todayInBogota } from "@/lib/format";

export function useDayRefresh() {
  const router = useRouter();
  useEffect(() => {
    let observedDay = todayInBogota();
    const timer = window.setInterval(() => {
      const currentDay = todayInBogota();
      if (currentDay !== observedDay) {
        observedDay = currentDay;
        router.refresh();
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [router]);
}
