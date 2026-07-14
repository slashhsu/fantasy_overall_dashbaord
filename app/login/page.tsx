import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { isPageAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isPageAuthenticated()) redirect("/");
  return <LoginForm />;
}
