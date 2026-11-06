/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 録画に左下の開発用バッジ（丸い N）が映らないようにする
  devIndicators: false,
  // 会話の保存（data/runtime）と試しの結果（runs）を書いても、録画中にページが読み直されないようにする
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/node_modules/**", "**/.git/**", "**/data/runtime/**", "**/runs/**"],
    };
    return config;
  },
};

export default nextConfig;
