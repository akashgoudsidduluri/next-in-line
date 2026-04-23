import { useEffect, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetJobDashboard,
  getGetJobDashboardQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format, differenceInSeconds } from "date-fns";
import {
  ArrowLeft,
  Clock,
  Activity,
  ListOrdered,
  AlertTriangle,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

function CountdownTimer({ deadline }: { deadline: string }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, differenceInSeconds(new Date(deadline), new Date())),
  );
  useEffect(() => {
    const t = setInterval(() => {
      setRemaining(Math.max(0, differenceInSeconds(new Date(deadline), new Date())));
    }, 1000);
    return () => clearInterval(t);
  }, [deadline]);
  if (remaining === 0) return <span className="text-destructive font-mono text-sm">Expired</span>;
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return (
    <span className={`font-mono text-sm ${remaining < 60 ? "text-amber-500" : "text-muted-foreground"}`}>
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}

export default function JobDashboard() {
  const { jobId } = useParams();
  const [, setLocation] = useLocation();

  const { data: dashboard, isLoading, error } = useGetJobDashboard(jobId || "", {
    query: {
      enabled: !!jobId,
      queryKey: getGetJobDashboardQueryKey(jobId || ""),
      refetchInterval: 2000,
      retry: false,
    },
  });

  if (!jobId) return null;

  if (error) {
    const status = (error as any)?.status;
    return (
      <main className="max-w-2xl mx-auto px-6 py-16">
        <Card className="text-center p-10">
          <AlertTriangle className="w-10 h-10 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-medium mb-2">
            {status === 403 ? "Not your job" : "Job unavailable"}
          </h2>
          <p className="text-muted-foreground mb-6">
            {status === 403
              ? "This job belongs to another company. Only its owner can view the pipeline."
              : "We couldn't load this job. Please return to the dashboard."}
          </p>
          <Button onClick={() => setLocation("/company")}>Back to dashboard</Button>
        </Card>
      </main>
    );
  }

  if (isLoading && !dashboard) {
    return <div className="p-8 text-center text-muted-foreground">Loading dashboard…</div>;
  }
  if (!dashboard) return <div className="p-8">Job not found.</div>;

  const { job, active, waitlist, recentEvents } = dashboard;
  const isFull = active.length >= job.capacity;

  return (
    <div>
      <div className="border-b border-border bg-card/30 px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/company"
              className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted"
            >
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
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              Live · polling 2s
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-t-4 border-t-green-500 shadow-sm flex flex-col">
          <CardHeader className="pb-3 border-b bg-muted/10">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity size={16} className="text-green-500" />
                Active cohort
              </CardTitle>
              <Badge variant="outline">{active.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-grow">
            {active.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No active applicants yet.
              </div>
            ) : (
              <div className="divide-y">
                {active.map((app) => (
                  <div
                    key={app.id}
                    className="p-4 flex items-center justify-between hover:bg-muted/30"
                  >
                    <div>
                      <div className="font-medium text-sm">{app.applicantName}</div>
                      <div className="text-xs text-muted-foreground">{app.applicantEmail}</div>
                    </div>
                    <div className="text-right">
                      {app.acknowledgedAt ? (
                        <Badge
                          variant="secondary"
                          className="bg-green-500/10 text-green-700 border-green-500/20"
                        >
                          Acknowledged
                        </Badge>
                      ) : (
                        <div className="flex flex-col items-end">
                          <Badge
                            variant="outline"
                            className="border-amber-500/30 text-amber-600 bg-amber-500/5"
                          >
                            Pending ack
                          </Badge>
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
                Waitlist
              </CardTitle>
              <Badge variant="outline">{waitlist.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-grow">
            {waitlist.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Waitlist is empty.
              </div>
            ) : (
              <div className="divide-y">
                {waitlist.map((app, idx) => (
                  <div key={app.id} className="p-4 flex items-center hover:bg-muted/30">
                    <div className="w-8 flex-shrink-0 text-center font-mono text-sm font-bold text-muted-foreground">
                      #{app.queuePosition || idx + 1}
                    </div>
                    <div className="flex-grow pl-3">
                      <div className="font-medium text-sm flex items-center gap-2">
                        {app.applicantName}
                        {app.decayCount > 0 && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1 py-0 h-4 bg-red-100 text-red-700"
                          >
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

        <Card className="lg:col-span-2">
          <CardHeader className="border-b bg-muted/5 pb-3">
            <CardTitle className="text-base">Event log</CardTitle>
            <CardDescription>State transitions in real time.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {recentEvents.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No events yet.</div>
            ) : (
              <div className="divide-y max-h-[320px] overflow-y-auto">
                {recentEvents.map((event) => (
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
      </main>
    </div>
  );
}
