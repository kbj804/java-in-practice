package kr.aloui.community.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.time.Clock

// 현재 시각을 직접 부르지 않고 Clock 을 주입받는다. 테스트에서는 고정 Clock 으로 바꾼다.
@Configuration
class ClockConfig {
    @Bean
    fun clock(): Clock = Clock.systemUTC()
}
