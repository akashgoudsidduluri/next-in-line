import React, { useEffect, useState } from "react";
import { useParams } from "wouter";
import { 
  useGetApplicationStatus, 
  getGetApplicationStatusQueryKey,
  useAcknowledgeApplication,
  useExitApplication
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format, differenceInSeconds } from "date-fns";
import { 
  CheckCircle2, 
  Clock, 
  DoorOpen, 
  ListOrdered, 
  Activity,
  AlertTriangle
} from "lucide-react";

function BigCountdown({ deadline, onExpire }: { deadline: string, onExpire?: () => void }) {
  const [remaining, setRemaining] = useState(() => 
    Math.max(0, differenceInSeconds(new Date(deadline), new Date()))
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Math.max(0, differenceInSeconds(new Date(deadline), new Date()));
      setRemaining(diff);
      if (diff === 0 && onExpire) {
        onExpire();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, onExpire]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  
  const isUrgent = remaining > 0 && remaining < 60;
  
  if (remaining === 0) {
    return <div className="text-2xl font-mono font-bold text-destructive">EXPIRED</div>;
  }
  
  return (
    <div className={`text-4xl font-mono font-bold tracking-tighter ${isUrgent ? 'text-destructive animate-pulse' : 'text-primary'}`}>
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </div>
  );
}

export default function ApplicantView() {
  const { applicationId } = useParams();
  const queryClient = useQueryClient();
  
  const { data: status, isLoading } = useGetApplicationStatus(applicationId || "", {
    query: { 
      enabled: !!applicationId, 
      queryKey: getGetApplicationStatusQueryKey(applicationId || ""),
      refetchInterval: 1000 
    }
  });

  const acknowledge = useAcknowledgeApplication();
  const exit = useExitApplication();

  const handleAcknowledge = () => {
    if (!applicationId) return;
    acknowledge.mutate(
      { applicationId },
      {
        onSuccess: () => {
          toast.success("Successfully acknowledged!");
          queryClient.invalidateQueries({ queryKey: getGetApplicationStatusQueryKey(applicationId) });
        },
        onError: () => toast.error("Failed to acknowledge. You may have timed out.")
      }
    );
  };

  const handleExit = () => {
    if (!applicationId) return;
    if (!confirm("Are you sure you want to withdraw your application? This cannot be undone.")) return;
    
    exit.mutate(
      { applicationId },
      {
        onSuccess: () => {
          toast.success("You have exited the pipeline.");
          queryClient.invalidateQueries({ queryKey: getGetApplicationStatusQueryKey(applicationId) });
        },
        onError: () => toast.error("Failed to process exit.")
      }
    );
  };

  if (!applicationId) return null;

  if (isLoading && !status) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-muted/20">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-muted"></div>
          <div className="h-4 w-32 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-muted/20 p-6">
        <Card className="max-w-md w-full text-center p-8">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-medium mb-2">Application Not Found</h2>
          <p className="text-muted-foreground mb-6">The application ID is invalid or the record has been permanently removed.</p>
        </Card>
      </div>
    );
  }

  const isWaitlisted = status.state === "WAITLISTED";
  const isActive = status.state === "ACTIVE";
  const isExited = status.state === "EXITED";
  const needsAck = isActive && !status.acknowledgedAt && status.ackDeadline;
  const isAcked = isActive && status.acknowledgedAt;

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-xl w-full">
        
        <div className="mb-8 text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Applicant Portal</h1>
          <p className="text-sm text-slate-500 font-mono bg-slate-200/50 inline-block px-3 py-1 rounded-full">
            ID: {status.id}
          </p>
        </div>

        <Card className="shadow-lg border-0 overflow-hidden">
          
          <div className={`h-2 w-full ${
            isWaitlisted ? 'bg-amber-400' : 
            isActive ? 'bg-primary' : 'bg-slate-300'
          }`} />

          <CardHeader className="bg-white border-b pb-6 pt-8 text-center">
            <div className="mx-auto w-16 h-16 rounded-full mb-4 flex items-center justify-center bg-slate-50 border shadow-sm">
              {isWaitlisted && <ListOrdered size={24} className="text-amber-500" />}
              {isActive && <Activity size={24} className="text-primary" />}
              {isExited && <DoorOpen size={24} className="text-slate-400" />}
            </div>
            
            <CardTitle className="text-2xl mb-1">{status.applicantName}</CardTitle>
            <div className="text-sm text-slate-500">{status.applicantEmail}</div>
            
            <div className="mt-6 inline-flex">
              <Badge variant="outline" className={`px-4 py-1.5 text-sm uppercase tracking-wider font-medium
                ${isWaitlisted ? 'border-amber-200 text-amber-700 bg-amber-50' : ''}
                ${isActive ? 'border-primary/30 text-primary bg-primary/5' : ''}
                ${isExited ? 'border-slate-200 text-slate-500 bg-slate-50' : ''}
              `}>
                {status.state}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="p-8 bg-white">
            
            {isWaitlisted && (
              <div className="text-center space-y-6">
                <div className="p-6 bg-slate-50 rounded-xl border border-slate-100 shadow-inner">
                  <div className="text-sm text-slate-500 uppercase tracking-wider font-semibold mb-2">Current Position</div>
                  <div className="text-6xl font-light tracking-tighter text-slate-900">
                    #{status.queuePosition}
                  </div>
                </div>
                <p className="text-sm text-slate-600 max-w-sm mx-auto leading-relaxed">
                  You are currently on the waitlist. You will be automatically promoted to ACTIVE when capacity becomes available.
                </p>
                
                {status.decayCount && status.decayCount > 0 ? (
                  <div className="bg-red-50 border border-red-100 text-red-800 text-xs p-4 rounded-lg text-left">
                    <strong className="block mb-1">Penalty Applied ({status.decayCount}x)</strong>
                    You missed previous acknowledgement windows and were sent back to the queue with a penalty.
                  </div>
                ) : null}
              </div>
            )}

            {isActive && (
              <div className="text-center space-y-6">
                {needsAck ? (
                  <div className="p-6 bg-primary/5 rounded-xl border border-primary/20 space-y-4">
                    <div className="flex justify-center mb-2">
                      <Clock className="w-8 h-8 text-primary animate-pulse" />
                    </div>
                    <div>
                      <div className="text-sm text-slate-600 font-medium mb-2 uppercase tracking-wide">Action Required</div>
                      <BigCountdown deadline={status.ackDeadline!} />
                    </div>
                    <p className="text-sm text-slate-600 mt-4 leading-relaxed">
                      You have been promoted! Acknowledge within the time limit to secure your active spot, or you will decay back to the waitlist.
                    </p>
                    <Button 
                      size="lg" 
                      className="w-full mt-4 text-base h-14 shadow-md"
                      onClick={handleAcknowledge}
                      disabled={acknowledge.isPending}
                    >
                      {acknowledge.isPending ? "Processing..." : "Acknowledge Promotion"}
                    </Button>
                  </div>
                ) : isAcked ? (
                  <div className="p-8 bg-green-50 rounded-xl border border-green-100 text-center">
                    <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-green-900 mb-2">Successfully Active</h3>
                    <p className="text-sm text-green-800/80">
                      You are actively in the pipeline. We will be in touch soon.
                    </p>
                    <div className="mt-4 text-xs font-mono text-green-700/60">
                      Ack'd at {format(new Date(status.acknowledgedAt!), "HH:mm:ss")}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {isExited && (
              <div className="text-center py-8">
                <p className="text-slate-500">
                  This application has been closed and is no longer in the queue.
                </p>
              </div>
            )}

          </CardContent>

          {!isExited && (
            <CardFooter className="bg-slate-50 border-t p-6 flex justify-center">
              <Button 
                variant="ghost" 
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleExit}
                disabled={exit.isPending}
              >
                Withdraw Application
              </Button>
            </CardFooter>
          )}
        </Card>
        
        <div className="mt-8 text-center text-xs text-slate-400">
          Powered by Hiring Pipeline
        </div>
      </div>
    </div>
  );
}
