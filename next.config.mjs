/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 録画に左下の開発用バッジ（丸い N）が映らないようにする
  devIndicators: false,
  // 作り手が自分のスマホから Tailscale（*.ts.net の名前）で開発サーバーを開けるように（開発の時だけ効く）。
  // これが無いと、localhost 以外から開いた画面は「読み込み中…」で止まる（開発用のつなぎ口を断られるため）
  allowedDevOrigins: ["**.ts.net"],
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
