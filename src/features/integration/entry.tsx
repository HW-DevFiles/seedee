"use client";
import { useEffect, useRef } from "react";
import { processWorkspaceEntry } from "./entry-action";
export function WorkspaceEntry({ agencyId }: { agencyId: string }) {
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void processWorkspaceEntry(agencyId);
    }
  }, [agencyId]);
  return null;
}
