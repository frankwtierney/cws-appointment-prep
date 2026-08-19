import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const hasGitHubPagesCustomDomain = Boolean(process.env.PAGES_CUSTOM_DOMAIN);
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "cws-appointment-prep";
const pagesBasePath = isGitHubPages && !hasGitHubPagesCustomDomain ? `/${repositoryName}` : "";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: pagesBasePath,
  trailingSlash: isGitHubPages,
  images: { unoptimized: true },
};

export default nextConfig;
