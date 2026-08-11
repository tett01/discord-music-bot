// pm2 실행 설정. `pm2 start ecosystem.config.js`로 사용한다.
module.exports = {
  apps: [
    {
      name: 'music-bot',
      script: 'src/index.js',
      cwd: __dirname,

      // 봇이 죽으면 자동으로 다시 띄운다.
      autorestart: true,
      // 연속 실패 시 재시작 간격을 점점 늘린다. (네트워크 장애 등에서 무한 재시작 방지)
      exp_backoff_restart_delay: 5000,
      // 토큰 오류처럼 고칠 때까지 계속 실패하는 상황에서 무한 루프를 막는다.
      max_restarts: 15,
      // 10초 안에 죽으면 비정상 종료로 간주한다.
      min_uptime: 10_000,

      // 소스 변경 감시는 끈다. (직접 재시작)
      watch: false,

      // 로그에 타임스탬프를 남긴다.
      time: true,
      merge_logs: true,
    },
  ],
};
