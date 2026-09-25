import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { getSessionUser } from "@/server/auth/session";

export const metadata = { title: "Get started" };

export default async function SignUp() {
  if (await getSessionUser()) redirect("/home");
  return <AuthForm mode="sign-up" googleEnabled={!!process.env.GOOGLE_CLIENT_ID} />;
}
