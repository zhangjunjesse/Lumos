"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BindingDialog } from "./BindingDialog";

interface BindingButtonProps {
  sessionId: string;
  onSuccess?: () => void;
}

export function BindingButton({ sessionId, onSuccess }: BindingButtonProps) {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkConfig = async () => {
      try {
        const res = await fetch("/api/bridge/config");
        const data = await res.json();
        setConfigured(data.configured);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    checkConfig();
  }, []);

  if (loading || !configured) return null;

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
              </svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent>同步到飞书群组</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <BindingDialog open={open} onOpenChange={setOpen} sessionId={sessionId} onSuccess={onSuccess} />
    </>
  );
}
