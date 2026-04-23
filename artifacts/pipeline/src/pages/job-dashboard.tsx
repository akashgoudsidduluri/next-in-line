import React, { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "wouter";
import { 
  useGetJobDashboard, 
  getGetJobDashboardQueryKey,
  useApplyToJob,
  useListJobEvents,
  getListJobEventsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format, differenceInSeconds } from "date-fns";
import { 
  ArrowLeft, 
  Copy, 
  UserPlus, 
  Clock, 
  Activity, 
  ListOrdered,
  AlertCircle
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

function CountdownTimer({ deadline }: { deadline: string }) {
  const [remaining, setRemaining] = useState(() => 
    Math.max(0, differenceInSeconds(new Date(deadline), new Date()))
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Math.max(0, differenceInSeconds(new Date(deadline), new Date()));
      setRemaining(diff);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  if (remaining === 0) return <span className="text-destructive font-mono text-sm">Expired</span>;
  
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  
  return (
    <span className={`font-mono text-sm ${remaining < 60 ? 'text-amber-500' : 'text-muted-foreground'}`}>
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </span>
  );
}

export default function JobDashboard() {
  const { jobId } = useParams();
  const queryClient = useQueryClient();
  
  // Use polling for determinism
  const { data: dashboard, isLoading: isDashboardLoading } = useGetJobDashboard(jobId || "", {
    query: { 
      enabled: !!jobId, 
      queryKey: getGetJobDashboardQueryKey(jobId || ""),
      refetchInterval: 2000 
    }
  });

  const applyToJob = useApplyToJob();
  
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobId || !name || !email) return;

    applyToJob.mutate(
      { jobId, data: { name, email } },
      {
        onSuccess: (app) => {
          queryClient.invalidateQueries({ queryKey: getGetJobDashboardQueryKey(jobId) });
          queryClient.invalidateQueries({ queryKey: getListJobEventsQueryKey(jobId) });
          setName("");
          setEmail("");
          toast.success("Application created", {
            description: `ID: ${app.id}`,
            action: {
              label: "Copy Link",
              onClick: () => {
                navigator.clipboard.writeText(`${window.location.origin}${import.meta.env.BASE_URL}apply/${app.id}`);
                toast.info("Link copied to clipboard");
              }
            }
          });
        },
        onError: () => toast.error("Failed to add applicant")
      }
    );
  };

  if (!jobId) return null;

  if (isDashboardLoading && !dashboard) {
    return <div className="p-8 flex items-center justify-center">Loading dashboard...</div>;
  }

  if (!dashboard) {
    return <div className="p-8">Job not found.</div>;
  }

  const { job, active, waitlist, recentEvents } = dashboard;
  
  const capacityPercent = (active.length / job.capacity) * 100;
  const isFull = active.length >= job.capacity;

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border bg-card/50 px-6 py-3 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted">
              <ArrowLeft size={18} />
            </Link>
            <Separator orientation="vertical" className="h-6" />
            <div>
              <h1 className="font-medium">{job.title}</h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <span className="font-mono">{job.id.substring(0, 8)}</span>
                <span>•</span>
                <span>Created {format(new Date(job.createdAt), "MMM d, yyyy")}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={isFull ? "secondary" : "default"} className="flex gap-1.5 font-normal">
              <Activity size={12} />
              {active.length} / {job.capacity} Active
            </Badge>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground border px-2 py-1 rounded-md bg-muted/30">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              Live
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        <div className="lg:col-span-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-t-4 border-t-green-500 shadow-sm flex flex-col">
              <CardHeader className="pb-3 border-b bg-muted/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity size={16} className="text-green-500" />
                    Active Cohort
                  </CardTitle>
                  <Badge variant="outline">{active.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-grow">
                {active.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3">
                      <UserPlus size={16} />
                    </div>
                    No active applicants.
                    {waitlist.length > 0 && <span className="block mt-1">Waitlist promotion pending.</span>}
                  </div>
                ) : (
                  <div className="divide-y">
                    {active.map(app => (
                      <div key={app.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                        <div>
                          <div className="font-medium text-sm">{app.applicantName}</div>
                          <div className="text-xs text-muted-foreground">{app.applicantEmail}</div>
                        </div>
                        <div className="text-right">
                          {app.acknowledgedAt ? (
                            <Badge variant="secondary" className="bg-green-500/10 text-green-700 border-green-500/20">Acknowledged</Badge>
                          ) : (
                            <div className="flex flex-col items-end">
                              <Badge variant="outline" className="border-amber-500/30 text-amber-600 bg-amber-500/5">Pending Ack</Badge>
                              {app.ackDeadline && (
                                <div className="mt-1 flex items-center gap-1 text-xs">
                                  <Clock size={10} className="text-muted-foreground" />
                                  <CountdownTimer deadline={app.ackDeadline} />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-t-4 border-t-amber-500 shadow-sm flex flex-col">
              <CardHeader className="pb-3 border-b bg-muted/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ListOrdered size={16} className="text-amber-500" />
                    Waitlist Queue
                  </CardTitle>
                  <Badge variant="outline">{waitlist.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-grow">
                {waitlist.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3">
                      <ListOrdered size={16} />
                    </div>
                    Waitlist is empty.
                  </div>
                ) : (
                  <div className="divide-y">
                    {waitlist.map((app, idx) => (
                      <div key={app.id} className="p-4 flex items-center hover:bg-muted/30 transition-colors">
                        <div className="w-8 flex-shrink-0 text-center font-mono text-sm font-bold text-muted-foreground">
                          #{app.queuePosition || idx + 1}
                        </div>
                        <div className="flex-grow pl-3">
                          <div className="font-medium text-sm flex items-center gap-2">
                            {app.applicantName}
                            {app.decayCount > 0 && (
                              <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-red-100 text-red-700">
                                Decayed ×{app.decayCount}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{app.applicantEmail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="border-b bg-muted/5 pb-3">
              <CardTitle className="text-base">Event Log</CardTitle>
              <CardDescription>System events and state transitions.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {recentEvents.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No events yet.</div>
              ) : (
                <div className="divide-y max-h-[300px] overflow-y-auto">
                  {recentEvents.map(event => (
                    <div key={event.id} className="p-4 flex gap-4 text-sm">
                      <div className="text-muted-foreground text-xs font-mono whitespace-nowrap mt-0.5">
                        {format(new Date(event.createdAt), "HH:mm:ss")}
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {event.eventType}
                          <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                            {event.applicationId.substring(0, 8)}
                          </span>
                        </div>
                        {event.metadata && Object.keys(event.metadata).length > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground font-mono bg-muted/30 p-2 rounded">
                            {JSON.stringify(event.metadata)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <Card className="sticky top-24 shadow-sm border-primary/20">
            <CardHeader className="bg-primary/5 pb-4">
              <CardTitle className="text-base text-primary">Manually Add Applicant</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <form onSubmit={handleApply} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="Jane Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="jane@example.com"
                  />
                </div>
                
                <div className="bg-amber-500/10 text-amber-800 p-3 rounded-md text-xs flex gap-2 items-start mt-2">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <p>
                    Adding an applicant will automatically place them in the <strong>Active</strong> state if capacity allows, otherwise they will be appended to the <strong>Waitlist</strong>.
                  </p>
                </div>

                <Button 
                  type="submit" 
                  className="w-full mt-2" 
                  disabled={applyToJob.isPending}
                >
                  {applyToJob.isPending ? "Adding..." : "Add to Pipeline"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

      </main>
    </div>
  );
}
