import React from "react";
import {
  useCreateJob,
  useListJobs,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Briefcase, ChevronRight, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Company Dashboard
 * 
 * State Reflection Strategy:
 * - Deterministic Polling: Job metadata and live counts are refetched every 5s.
 * - Optimistic Invalidation: On job creation, the 'jobs' cache is immediately invalidated to provide instant feedback.
 * - Simplicity over Complexity: Polling was chosen over WebSockets/SSE to maintain a lean architecture while 
 *   providing sufficient real-time feel for recruitment use cases.
 */
export default function CompanyDashboard() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const companyId = auth?.role === "company" ? auth.company.id : "";

  // List only MY jobs using the newly implemented ownership-based endpoint
  const { data: myJobs, isLoading } = useListJobs({
    query: {
      queryKey: ["jobs", "me", companyId],
      queryFn: async () => {
        const res = await fetch("/api/jobs/me", {
          headers: auth ? { Authorization: `Bearer ${auth.token}` } : {},
        });
        if (!res.ok) throw new Error("Failed to fetch jobs");
        return res.json();
      },
      refetchInterval: 5000,
    },
  });

  const createJob = useCreateJob();

  const [title, setTitle] = React.useState("");
  const [capacity, setCapacity] = React.useState("3");
  const [decaySeconds, setDecaySeconds] = React.useState("300");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !capacity) return;
    createJob.mutate(
      {
        data: {
          title,
          capacity: parseInt(capacity, 10),
          decaySeconds: parseInt(decaySeconds, 10),
        },
      },
      {
        onSuccess: (job) => {
          queryClient.invalidateQueries({ queryKey: ["jobs", "me", companyId] });
          setTitle("");
          setCapacity("3");
          setDecaySeconds("300");
          toast.success(`Created "${job.title}"`);
        },
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to create job",
          ),
      },
    );
  };

  return (
    <main className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-6">
        <div>
          <h2 className="text-2xl font-medium">Your jobs</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Click a job to open its live pipeline.
          </p>
        </div>

        {isLoading ? (
          <Card className="animate-pulse">
            <CardHeader className="h-24 bg-muted/50 rounded-t-lg" />
          </Card>
        ) : (myJobs || []).length === 0 ? (
          <Card className="border-dashed bg-muted/10">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-4">
                <Briefcase size={24} />
              </div>
              <h3 className="text-lg font-medium mb-1">No jobs yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Use the form on the right to post your first role. Jobs you
                create here will appear in this list.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {(myJobs || []).map((job) => (
              <Link key={job.id} href={`/jobs/${job.id}`} className="block group">
                <Card className="transition-all hover:shadow-md hover:border-primary/30">
                  <CardContent className="p-6 flex items-center justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <h3 className="font-medium text-lg group-hover:text-primary transition-colors">
                          {job.title}
                        </h3>
                        <Badge variant="outline" className="font-mono text-xs">
                          {job.id.substring(0, 6)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-6 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-green-500" />
                          {job.activeCount} / {job.capacity} active
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-amber-500" />
                          {job.waitlistCount} waitlisted
                        </div>
                        <div className="text-xs">
                          Created{" "}
                          {formatDistanceToNow(new Date(job.createdAt))} ago
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="text-muted-foreground group-hover:text-primary" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="bg-muted/30 pb-4 border-b">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus size={16} /> Create a job
            </CardTitle>
            <CardDescription>
              Sets the active-cohort capacity and the ack window for promotions.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Job title</Label>
                <Input
                  id="title"
                  placeholder="Senior Frontend Engineer"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="capacity">Capacity</Label>
                  <Input
                    id="capacity"
                    type="number"
                    min={1}
                    max={100}
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="decay">Ack window (s)</Label>
                  <Input
                    id="decay"
                    type="number"
                    min={10}
                    value={decaySeconds}
                    onChange={(e) => setDecaySeconds(e.target.value)}
                    required
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={createJob.isPending}
              >
                {createJob.isPending ? "Creating…" : "Create job"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
