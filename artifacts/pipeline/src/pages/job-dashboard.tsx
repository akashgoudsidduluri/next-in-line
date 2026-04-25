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

        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader className="border-b bg-muted/5 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity size={16} className="text-primary" />
              Event log
            </CardTitle>
            <CardDescription>Real-time pipeline state transitions.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {recentEvents.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground italic">
                No pipeline activity recorded yet.
              </div>
            ) : (
              <div className="p-6 max-h-[400px] overflow-y-auto">
                <div className="relative space-y-6 before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                  {recentEvents.map((event) => {
                    const isApplied = event.eventType === "APPLIED";
                    const isPromoted = event.eventType === "PROMOTED";
                    const isAck = event.eventType === "ACKNOWLEDGED";
                    const isDecayed = event.eventType === "DECAYED";
                    const isExited = event.eventType === "EXITED";

                    return (
                      <div key={event.id} className="relative flex items-start gap-4 group">
                        <div className={`
                          flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-4 border-background shadow-sm z-10
                          ${isApplied ? "bg-blue-500 text-white" : ""}
                          ${isPromoted ? "bg-green-500 text-white" : ""}
                          ${isAck ? "bg-emerald-600 text-white" : ""}
                          ${isDecayed ? "bg-amber-500 text-white" : ""}
                          ${isExited ? "bg-red-500 text-white" : ""}
                        `}>
                          {isApplied && <Activity size={14} />}
                          {isPromoted && <Clock size={14} />}
                          {isAck && <Activity size={14} />}
                          {isDecayed && <AlertTriangle size={14} />}
                          {isExited && <AlertTriangle size={14} />}
                        </div>
                        <div className="flex flex-col gap-1 pt-1 flex-grow">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`font-semibold text-sm
                                ${isApplied ? "text-blue-700" : ""}
                                ${isPromoted ? "text-green-700" : ""}
                                ${isAck ? "text-emerald-700" : ""}
                                ${isDecayed ? "text-amber-700" : ""}
                                ${isExited ? "text-red-700" : ""}
                              `}>
                                {event.eventType}
                              </span>
                              <Badge variant="outline" className="font-mono text-[10px] py-0 h-4 px-1.5 opacity-60">
                                {event.applicationId.substring(0, 8)}
                              </Badge>
                            </div>
                            <time className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                              {format(new Date(event.createdAt), "HH:mm:ss")}
                            </time>
                          </div>
                          
                          <div className="text-sm text-muted-foreground leading-relaxed">
                            {isApplied && (
                              <span>Applicant joined the pipeline as <strong className="text-foreground">{String(event.metadata.admittedAs ?? "unknown")}</strong>.</span>
                            )}
                            {isPromoted && (
                              <span>Promoted to <strong className="text-green-600">ACTIVE</strong> due to <span className="italic">{String(event.metadata.reason ?? "unknown").toLowerCase().replace("_", " ")}</span>.</span>
                            )}
                            {isAck && (
                              <span>Applicant <strong className="text-emerald-600">ACKNOWLEDGED</strong> their spot in the active cohort.</span>
                            )}
                            {isDecayed && (
                              <span>Acknowledge window expired. Applicant <strong className="text-amber-600">DECAYED</strong> to waitlist position <span className="font-bold">#{String(event.metadata.newQueuePosition ?? "?")}</span>.</span>
                            )}
                            {isExited && (
                              <span>Applicant <strong className="text-red-600">EXITED</strong> the pipeline.</span>
                            )}
                          </div>

                          {event.metadata.decayCount !== undefined && (
                            <div className="mt-1 flex items-center gap-1.5">
                              <Badge variant="secondary" className="text-[9px] h-4 bg-red-50 text-red-600 border-red-100 uppercase tracking-tighter">
                                Decay ×{String(event.metadata.decayCount)}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
