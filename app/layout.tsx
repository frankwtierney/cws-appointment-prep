import type { Metadata } from "next";
import "./globals.css";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "cws-appointment-prep";
const basePath = process.env.GITHUB_ACTIONS === "true" && !process.env.PAGES_CUSTOM_DOMAIN ? `/${repositoryName}` : "";

export const metadata: Metadata = {
  title: "FWS Appointment Builder",
  description: "Prepare HR-ready Federal Work-Study appointment forms from the original UB PDF.",
  other: { "codex-preview": "development" },
  icons: { icon: `${basePath}/favicon.svg`, shortcut: `${basePath}/favicon.svg` },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
