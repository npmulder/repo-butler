import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  redirect(await getSignInUrl());
}
