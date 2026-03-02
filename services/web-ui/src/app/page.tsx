import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";

export default async function HomePage() {
  const session = await auth();

  if (!session) {
    redirect("/auth/signin");
  }

  return <AppShell />;
}
