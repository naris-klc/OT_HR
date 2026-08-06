/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mongoose must stay a real Node module — bundling it breaks model registration.
  serverExternalPackages: ['mongoose', 'bcryptjs'],
};

export default nextConfig;
