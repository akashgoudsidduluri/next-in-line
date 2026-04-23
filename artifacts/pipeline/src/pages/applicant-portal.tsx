import { useMemo } from "react";
import { Link } from "wouter";
import {
  useListJobs,
  useApplyToJob,
  getListJobsQueryKey,
  getGetApplicationStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Briefcase, ListChecks } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getMyApplicationIds,
  rememberMyApplication,
} from "@/lib/local-tracking";

export default function ApplicantPortal() {
  const { auth } = useAuth();
  const applicantId = auth?.role === "applicant" ? auth.applicant.id : "";
  const applicantName = auth?.role === "applicant" ? auth.applicant.name : "";
  const applicantEmail = auth?.role === "applicant" ? auth.applicant.email : "";
  const queryClient = useQueryClient();

  const { data: jobs, isLoading: jobsLoading } = useListJobs({
    query: { queryKey: getListJobsQueryKey(), refetchInterval: 3000 },
  });

  const myAppIds = getMyApplicationIds(applicantId);

  const myApps = useQueries({
    queries: myAppIds.map((id) => ({
      queryKey: getGetApplicationStatusQueryKey(id),
      queryFn: async () => {
        const res = await fetch(`/api/applications/${id}`, {
          headers: auth ? { Authorization: `Bearer ${auth.token}` } : {},
        });
        if (!res.ok) return null;
        return res.json();
      },
      refetchInterval: 2000,
    })),
  });

  const apply = useApplyToJob();

  const liveApps = useMemo(
    () =>
      myApps
        .map((q, i) => ({ id: myAppIds[i]!, data: q.data as any }))
        .filter((x) => x.data),
    [myApps, myAppIds],
  );

  const jobTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of jobs ?? []) m.set(j.id, j.title);
    return m;
  }, [jobs]);

  const appliedJobIds = useMemo(
    () => new Set(liveApps.filter((a) => a.data?.state !== "EXITED").map((a) => a.data.jobId)),
    [liveApps],
  );

  const handleApply = (jobId: string, jobTitle: string) => {
    // The backend ignores the body and uses the applicantId from the token,
    // but the generated request type still requires {name, email}.
    apply.mutate(
      { jobId, data: { name: applicantName, email: applicantEmail } },
      {
        onSuccess: (app) => {
          rememberMyApplication(applicantId, app.id);
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          toast.success(`Applied to ${jobTitle}`, {
            description: `You are ${app.state === "ACTIVE" ? "ACTIVE — please acknowledge!" : `#${app.queuePosition} on the waitlist`}.`,
          });
        },
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to apply",
          ),
      },
    );
  };

  return (
    <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <ListChecks size={20} className="text-primary" />
          <h2 className="text-2xl font-medium">Your applications</h2>
        </div>
        {liveApps.length === 0 ? (
          <Card className="border-dashed bg-muted/10">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No applications yet. Browse open jobs below to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {liveApps.map(({ id, data }) => (
              <Link key={id} href={`/apply/${id}`} className="block group">
                <Card className="transition-all hover:shadow-md hover:border-primary/30">
                  <CardContent className="p-5 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="font-medium group-hover:text-primary">
                        {jobTitleById.get(data.jobId) ?? "Application"}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {id.substring(0, 8)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        variant="outline"
                        className={
                          data.state === "ACTIVE"
                            ? "border-primary/30 text-primary bg-primary/5"
                            : data.state === "WAITLISTED"
                              ? "border-amber-300 text-amber-700 bg-amber-50"
                              : "border-slate-200 text-slate-500"
                        }
                      >
                        {data.state}
                      </Badge>
                      {data.state === "WAITLISTED" && (
                        <span className="text-xs text-muted-foreground">
                          #{data.queuePosition}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Briefcase size={20} className="text-primary" />
          <h2 className="text-2xl font-medium">Open jobs</h2>
        </div>
        {jobsLoading ? (
          <Card className="animate-pulse">
            <CardHeader className="h-24 bg-muted/50 rounded-t-lg" />
          </Card>
        ) : (jobs ?? []).length === 0 ? (
          <Card className="border-dashed bg-muted/10">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No jobs are open right now. Check back soon.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(jobs ?? []).map((job) => {
              const already = appliedJobIds.has(job.id);
              const full = job.activeCount >= job.capacity;
              return (
                <Card key={job.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{job.title}</CardTitle>
                    <CardDescription className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        {job.activeCount}/{job.capacity} active
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        {job.waitlistCount} waitlisted
                      </span>
                      <span>· posted {formatDistanceToNow(new Date(job.createdAt))} ago</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      onClick={() => handleApply(job.id, job.title)}
                      disabled={already || apply.isPending}
                      className="w-full"
                      variant={already ? "outline" : "default"}
                    >
                      {already
                        ? "Already applied"
                        : full
                          ? "Apply (joins waitlist)"
                          : "Apply"}
                      {!already && <ArrowRight size={14} className="ml-2" />}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
