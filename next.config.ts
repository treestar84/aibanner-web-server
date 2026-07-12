import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 출처 카드의 이미지 URL은 외부 콘텐츠에서 온다. 서버 측 Image Optimizer가
    // 임의 URL을 요청하지 않도록 최적화를 끄고, 브라우저가 HTTPS 원본을 직접
    // 불러오게 한다. 이로써 원격 이미지 기반 SSRF/캐시 DoS 공격면을 제거한다.
    unoptimized: true,
  },
};

export default nextConfig;
