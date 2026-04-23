import React from "react";
import { useListJobs, useCreateJob, getListJobsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Activity, Briefcase, ChevronRight, Search, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  const { data: jobs, isLoading } = useListJobs({ query: { queryKey: getListJobsQueryKey() } });
  const createJob = useCreateJob();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [title, setTitle] = React.useState("");
  const [capacity, setCapacity] = React.useState("5");
  const [applicationId, setApplicationId] = React.useState("");

  const handleCreateJob = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !capacity) return;

    createJob.mutate(
      { data: { title, capacity: parseInt(capacity, 10) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          setTitle("");
          setCapacity("5");
          toast.success("Job created successfully.");
        },
        onError: () => {
          toast.error("Failed to create job.");
        },
      }
    );
  };

  const handleLookupApplication = (e: React.FormEvent) => {
    e.preventDefault();
    if (applicationId) {
      setLocation(`/apply/${applicationId.trim()}`);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border bg-card/50 px-6 py-4 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary">
              <Briefcase size={18} />
            </div>
            <h1 className="text-xl font-medium tracking-tight">Hiring Pipeline</h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            System Operational
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-between items-end">
            <div>
              <h2 className="text-2xl font-medium">Active Jobs</h2>
              <p className="text-muted-foreground mt-1 text-sm">Monitor capacities and waitlists across open roles.</p>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader className="h-24 bg-muted/50 rounded-t-lg" />
                </Card>
              ))}
            </div>
          ) : jobs?.length === 0 ? (
            <Card className="border-dashed bg-muted/10">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-4">
                  <Briefcase size={24} />
                </div>
                <h3 className="text-lg font-medium mb-1">No active jobs</h3>
                <p className="text-sm text-muted-foreground max-w-sm mb-6">
                  Create a job to start managing your hiring pipeline with strict capacity controls.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {jobs?.map((job) => (
                <Link key={job.id} href={`/jobs/${job.id}`} className="block group">
                  <Card className="transition-all duration-200 hover:shadow-md hover:border-primary/30">
                    <CardContent className="p-6 flex items-center justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <h3 className="font-medium text-lg group-hover:text-primary transition-colors">{job.title}</h3>
                          <Badge variant="outline" className="font-mono text-xs text-muted-foreground">ID: {job.id.substring(0, 6)}</Badge>
                        </div>
                        <div className="flex items-center gap-6 text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-500"></div>
                            {job.activeCount} / {job.capacity} Active
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                            {job.waitlistCount} Waitlisted
                          </div>
                          <div className="text-xs">
                            Created {formatDistanceToNow(new Date(job.createdAt))} ago
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="text-muted-foreground group-hover:text-primary transition-colors" />
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
                <Plus size={16} /> Create Job
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form onSubmit={handleCreateJob} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Job Title</Label>
                  <Input
                    id="title"
                    placeholder="e.g. Senior Frontend Engineer"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capacity">Capacity (Active limit)</Label>
                  <Input
                    id="capacity"
                    type="number"
                    min="1"
                    max="100"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum number of candidates allowed in ACTIVE state simultaneously.
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={createJob.isPending}>
                  {createJob.isPending ? "Creating..." : "Create Job"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-4">
              <CardTitle className="text-base text-primary flex items-center gap-2">
                <Search size={16} /> Applicant Portal
              </CardTitle>
              <CardDescription>
                Check your application status and manage your queue position.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLookupApplication} className="space-y-4">
                <div className="space-y-2">
                  <Input
                    placeholder="Enter Application ID"
                    value={applicationId}
                    onChange={(e) => setApplicationId(e.target.value)}
                    className="bg-card font-mono text-sm"
                  />
                </div>
                <Button type="submit" variant="secondary" className="w-full">
                  Check Status
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
