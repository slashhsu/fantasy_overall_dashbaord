import { redirect } from "next/navigation";
import { DraftAssistant } from "@/components/draft-assistant";
import { isPageAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DraftPage() {
  if (!(await isPageAuthenticated())) redirect("/login");
  return <DraftAssistant />;
}
