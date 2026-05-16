import path from 'path';
import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

loadEnv({ path: path.resolve(__dirname, '../../.env') });

const config: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../../'),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        search: '',
      },
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
        search: '',
      },
    ],
  },
};

export default config;
