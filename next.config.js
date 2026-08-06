/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mongoose must stay a real Node module — bundling it breaks model registration.
  serverExternalPackages: ['mongoose', 'bcryptjs'],

  // Dev-only. Testers hit the dev server over the office LAN, so their Origin is
  // the machine's DHCP address — without this Next 403s every /_next/* chunk.
  // Subnet wildcards keep working when DHCP hands out a different last octet.
  allowedDevOrigins: ['192.168.109.*', '172.16.4.*'],
};

export default nextConfig;
