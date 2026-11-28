package kr.aloui.community

import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.rabbitmq.RabbitMQContainer
import org.testcontainers.utility.DockerImageName
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfiguration {

    // 테스트마다 진짜 Postgres·RabbitMQ 컨테이너를 띄우고, @ServiceConnection 이 접속 설정을 덮어쓴다.
    @Bean
    @ServiceConnection
    fun postgresContainer(): PostgreSQLContainer = PostgreSQLContainer(DockerImageName.parse("postgres:17"))

    @Bean
    @ServiceConnection
    fun rabbitContainer(): RabbitMQContainer = RabbitMQContainer(DockerImageName.parse("rabbitmq:4.1"))

    @Bean
    @Primary
    fun testClock(): TestClock = TestClock(FIXED_NOW)

    companion object {
        val FIXED_NOW: Instant = Instant.parse("2026-11-21T00:00:00Z")
    }
}

/** 멈춰 있는 시계. 리스가 지난 상황을 만들려고 테스트에서 앞으로 돌린다. */
class TestClock(private val start: Instant) : Clock() {
    @Volatile
    private var now: Instant = start

    override fun getZone(): ZoneId = ZoneOffset.UTC
    override fun withZone(zone: ZoneId): Clock = this
    override fun instant(): Instant = now

    fun advance(duration: Duration) {
        now = now.plus(duration)
    }

    fun reset() {
        now = start
    }
}
