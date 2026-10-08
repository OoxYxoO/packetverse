import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Legacy URL: ARP and TCP/UDP used to share /demo/first-connection. They are separate lessons now
   * (/demo/arp-resolution, /demo/tcp-udp); old links and bookmarks land on ARP, where that page used to start.
   */
  async redirects() {
    return [{ source: "/demo/first-connection", destination: "/demo/arp-resolution", permanent: false }];
  },
};

export default nextConfig;
