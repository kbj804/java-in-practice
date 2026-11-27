package kr.aloui.community.post

import com.zaxxer.hikari.HikariDataSource
import kr.aloui.community.TestcontainersConfiguration
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource
import kotlin.time.measureTimedValue

/**
 * 실험 ①. 풀 3개, 커넥션 대기 한도 1초, 외부 호출 0.5초, 동시 요청 20개.
 * 결과는 "[실험①]" 로 시작하는 줄로 출력한다.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = [
        "spring.datasource.hikari.maximum-pool-size=3",
        "spring.datasource.hikari.connection-timeout=1000",
        "place-tagger.delay=500ms",
    ],
)
@Import(TestcontainersConfiguration::class)
class PoolExhaustionExperimentTest(
    @LocalServerPort private val port: Int,
    @Autowired private val dataSource: DataSource,
) {
    private val http = HttpClient.newHttpClient()

    @Test
    fun `트랜잭션 안에서 외부 호출을 기다리면 풀이 바닥나 요청이 실패한다`() {
        val result = fire("inside-tx")
        assertThat(result.failed).isGreaterThan(0)
    }

    @Test
    fun `외부 호출을 트랜잭션 밖으로 빼면 같은 풀로 모두 성공한다`() {
        val result = fire("outside-tx")
        assertThat(result.failed).isZero()
    }

    private fun fire(path: String, concurrency: Int = 20): Result {
        val pool = (dataSource as HikariDataSource).hikariPoolMXBean
        val maxWaiting = AtomicInteger()
        val sampling = AtomicBoolean(true)
        val sampler = Thread.ofVirtual().start {
            while (sampling.get()) {
                maxWaiting.accumulateAndGet(pool.threadsAwaitingConnection, ::maxOf)
                Thread.sleep(20)
            }
        }

        val start = CountDownLatch(1)
        val statuses = Executors.newFixedThreadPool(concurrency).use { executor ->
            val (futures, elapsed) = measureTimedValue {
                val futures = (1..concurrency).map { i ->
                    executor.submit<Int> {
                        start.await()
                        http.send(request(path, "서울숲공원 산책 모임 $i"), HttpResponse.BodyHandlers.discarding()).statusCode()
                    }
                }
                start.countDown()
                futures.map { it.get() }
            }
            println("[실험①] $path 걸린 시간 ${elapsed.inWholeMilliseconds}ms")
            futures
        }
        sampling.set(false)
        sampler.join()

        val result = Result(ok = statuses.count { it == 201 }, failed = statuses.count { it != 201 })
        println("[실험①] $path 성공 ${result.ok} / 실패 ${result.failed}, 커넥션 대기 스레드 최대 ${maxWaiting.get()}")
        return result
    }

    private fun request(path: String, content: String) = HttpRequest.newBuilder()
        .uri(URI.create("http://localhost:$port/experiments/pool/$path"))
        .header("content-type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString("""{"authorId": 1, "regionId": 300, "content": "$content"}"""))
        .build()

    private data class Result(val ok: Int, val failed: Int)
}
