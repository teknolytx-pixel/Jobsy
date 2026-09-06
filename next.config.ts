import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "media.licdn.com" }],
  },
  /**
   * bcryptjs is a native-adjacent module that must not be bundled into the
   * server chunk. `@prisma/client` used to be listed here too and was removed:
   * Prisma is not a dependency of this project and is not imported anywhere —
   * it arrives only as a peer of drizzle-orm. Naming it here implied a
   * database client we do not use, and carried a vulnerable transitive
   * (`deepmerge-ts`) that is now pinned in `overrides`.
   */
  serverExternalPackages: ["bcryptjs"],
};

export default config;
