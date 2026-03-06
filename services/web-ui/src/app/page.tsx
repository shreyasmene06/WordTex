import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";

export default async function HomePage() {
  const session = await auth();

  // In development, skip the sign-in redirect
  if (!session && process.env.NODE_ENV !== "development") {
    redirect("/auth/signin");
  }

  return <AppShell />;
}
