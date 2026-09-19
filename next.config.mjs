/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The Needle 3 engine is loaded at runtime via __non_webpack_require__, so
    // tracing cannot see these files. Ship them with the server output.
    outputFileTracingIncludes: {
      "/api/intent": ["./lib/needle/**", "./needle3.cact"],
    },
  },
};

export default nextConfig;
