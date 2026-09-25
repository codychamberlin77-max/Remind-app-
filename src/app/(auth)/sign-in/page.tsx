import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { getSessionUser } from "@/server/auth/session";

export const metadata = { title: "Sign in" };

export default async function SignIn() {
  if (await getSessionUser()) redirect("/home");
  return <AuthForm mode="sign-in" googleEnabled={!!process.env.GOOGLE_CLIENT_ID} />;
}
