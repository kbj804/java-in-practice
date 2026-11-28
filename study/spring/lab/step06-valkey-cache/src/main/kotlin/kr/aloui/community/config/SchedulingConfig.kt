package kr.aloui.community.config

import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableScheduling

// step06: 지연 이중 삭제(PostEviction)가 TaskScheduler 로 "1초 뒤 한 번 더 지우기"를 건다.
// 릴레이·스케줄러를 끈 테스트에서도 TaskScheduler 가 있도록 스케줄링을 늘 켜 둔다. (@Scheduled 메서드는 각자의 조건대로만 돈다)
@Configuration
@EnableScheduling
class SchedulingConfig
