import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "media.licdn.com" }],
  },
  // Prisma needs to stay external in the server bundle
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default config;
