import { redirect } from "next/navigation";

/**
 * Root page — immediately redirects to /dashboard.
 */
export default function RootPage() {
  redirect("/dashboard");
}
