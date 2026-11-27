package kr.aloui.community

import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfiguration {

    // 테스트마다 진짜 Postgres 컨테이너를 띄우고, @ServiceConnection 이 datasource 설정을 덮어쓴다.
    @Bean
    @ServiceConnection
    fun postgresContainer(): PostgreSQLContainer = PostgreSQLContainer(DockerImageName.parse("postgres:17"))

    @Bean
    @Primary
    fun fixedClock(): Clock = Clock.fixed(FIXED_NOW, ZoneOffset.UTC)

    companion object {
        val FIXED_NOW: Instant = Instant.parse("2026-11-21T00:00:00Z")
    }
}
