import { listJobs } from "@/lib/data-queue";
import { QueueClient } from "@/components/queue/queue-client";

export default async function QueuePage() {
  const jobs = await listJobs();
  return <QueueClient initialJobs={jobs} />;
}
