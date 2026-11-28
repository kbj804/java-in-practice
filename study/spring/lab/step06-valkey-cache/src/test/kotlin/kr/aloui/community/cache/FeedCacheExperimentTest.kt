package kr.aloui.community.cache

import kr.aloui.community.TestcontainersConfiguration
import kr.aloui.community.message.CACHE_QUEUE
import kr.aloui.community.outbox.OutboxRelay
import kr.aloui.community.post.POST_CREATED
import kr.aloui.community.post.POST_UPDATED
import kr.aloui.community.post.PostEventPayload
import kr.aloui.community.post.PostService
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.kotlin.atMost
import org.awaitility.kotlin.await
import org.awaitility.kotlin.until
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.amqp.core.MessageBuilder
import org.springframework.amqp.core.MessageProperties
import org.springframework.amqp.rabbit.core.RabbitTemplate
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * 실험 ⑤. 동네 최신 글 목록을 Valkey 에 두고, 사람이 몰리는 저녁 시간에 생기는 일을 본다.
 * 결과는 "[실험⑤]" 로 시작하는 줄로 출력한다.
 *
 * - 목록 DB 쿼리는 50ms 가 걸리게 해 둔다(rebuild-delay). 키가 빈 50ms 동안 들어온 요청이 어떻게 되는지 보려는 것.
 * - 글 요약 TTL 은 3초, 지터는 0. 늦게 도착한 SET 이 남긴 옛 값이 언제 사라지는지 짧게 보려는 것.
 * - 릴레이·알림 스케줄러는 끄고, 테스트가 정한 때에 직접 돌린다.
 */
@SpringBootTest(
    properties = [
        "outbox.relay.enabled=false", "notification.sweeper.enabled=false",
        "cache.feed.rebuild-delay=PT0.05S", "cache.feed.jitter=PT0S",
        "cache.post.ttl=PT3S", "cache.post.jitter=PT0S", "cache.post.double-delete-delay=PT1S",
    ],
)
@Import(TestcontainersConfiguration::class)
class FeedCacheExperimentTest(
    @Autowired private val redis: StringRedisTemplate,
    @Autowired private val rabbit: RabbitTemplate,
    @Autowired private val jdbc: JdbcClient,
    @Autowired private val jsonMapper: JsonMapper,
    @Autowired private val postService: PostService,
    @Autowired private val relay: OutboxRelay,
    @Autowired private val feed: RegionFeed,
    @Autowired private val feedCache: RegionFeedCache,
    @Autowired private val postCache: PostCache,
    @Autowired private val cacheListener: PostCacheListener,
    @Autowired private val singleDelete: SingleDeleteCacheListener,
) {
    @BeforeEach
    fun flush() {
        redis.execute { it.serverCommands().flushAll(); null }
    }

    @Test
    fun `가 나 - 목록 키가 빈 순간 동시에 150명이 열면, 락이 없으면 150번 DB 로 가고 single-flight 는 1번 간다`() {
        for ((name, withLock) in listOf("가 락 없음" to false, "나 single-flight" to true)) {
            val region = seedRegion(posts = 30)
            feed.latest(region) // 목록과 글 요약을 채워 둔다
            redis.delete(CacheKeys.feed(region)) // 블라인드 처리 등으로 목록 키만 지워진 순간

            val before = feedCache.rebuilds.get()
            val requests = 150
            val start = CountDownLatch(1)
            val pool = Executors.newFixedThreadPool(requests)
            val tasks = (1..requests).map {
                pool.submit<Pair<Int, Long>> {
                    start.await()
                    val t0 = System.nanoTime()
                    val items = if (withLock) feed.latest(region) else feed.latestWithoutLock(region)
                    items.size to (System.nanoTime() - t0) / 1_000_000
                }
            }
            start.countDown() // 150명이 같은 때 연다
            val results = tasks.map { it.get() }
            pool.shutdown()

            val dbQueries = feedCache.rebuilds.get() - before
            val slowest = results.maxOf { it.second }
            println("[실험⑤] $name · 목록 키가 빈 순간 동시 $requests 명 → 목록 DB 쿼리 ${dbQueries}번, 가장 늦은 응답 ${slowest}ms (쿼리 50ms, 커넥션 풀 10)")
            assertThat(results).allMatch { it.first == 20 } // 모두 20개를 받았다
            if (withLock) assertThat(dbQueries).isEqualTo(1) else assertThat(dbQueries).isGreaterThan(100)
        }
    }

    @Test
    fun `다 - 새 글 수정 블라인드를 이벤트로 고치면 목록을 다시 만들지 않는다, 같은 이벤트가 두 번 와도 한 번만 들어간다`() {
        val region = seedRegion(posts = 0)
        val ids = (1..3).map { postService.create(1, region, "본문 $it", title = "글 $it").id!! }
        send(3)

        val first = feed.latest(region)
        val rebuildsAfterFirst = feedCache.rebuilds.get()
        assertThat(first.map { it.title }).containsExactly("글 3", "글 2", "글 1")

        val fourth = postService.create(1, region, "본문 4", title = "글 4").id!!
        send(1)
        postService.rename(ids[1], "글 2 (오타 고침)")
        send(1)
        postService.blind(ids[2])
        send(1)
        val before = cacheListener.handled.get()
        repeat(2) { publish(CACHE_QUEUE, POST_CREATED, fourth, region) } // 릴레이가 두 번 보낸 같은 메시지
        await atMost WAIT until { cacheListener.handled.get() == before + 2 }

        val now = feed.latest(region)
        val rebuilds = feedCache.rebuilds.get() - rebuildsAfterFirst
        println("[실험⑤] 다 이벤트로 고치기 · 새 글 → 맨 앞, 제목 수정 → 새 제목, 블라인드 → 빠짐, 같은 새 글 2번 → 1개. 목록: ${now.map { it.title }}, 목록 다시 만들기 ${rebuilds}번")
        assertThat(now.map { it.title }).containsExactly("글 4", "글 2 (오타 고침)", "글 1")
        assertThat(rebuilds).isZero() // 목록 키를 지우지 않았으니 DB 로 다시 만들 일이 없다
    }

    @Test
    fun `라 마 - DB 를 읽고 멈춘 요청이 삭제 뒤에 옛 제목을 넣으면, 한 번만 지우면 TTL 까지 남고 지연 이중 삭제는 1초 뒤 지운다`() {
        for ((name, queue) in listOf("라 한 번만 지움" to EXPERIMENT_SINGLE_DELETE_QUEUE, "마 지연 이중 삭제 1초" to CACHE_QUEUE)) {
            val region = seedRegion(posts = 0)
            val id = postService.create(1, region, "본문", title = "상추 나눔햇어요").id!!

            // ① 요청 R: 캐시 miss → DB 에서 옛 제목을 읽고 멈춘다(GC 등)
            val stale = postCache.loadFromDb(listOf(id)).single()
            // ② 그사이 작성자가 제목을 고치고(DB 커밋), 캐시 리스너가 지운다
            postService.rename(id, "상추 나눔했어요")
            val listener = if (queue == CACHE_QUEUE) cacheListener.handled else singleDelete.handled
            val before = listener.get()
            publish(queue, POST_UPDATED, id, region)
            await atMost WAIT until { listener.get() == before + 1 }
            // ③ R 이 깨어나 읽어 둔 옛 제목을 넣는다
            postCache.put(stale)
            val t0 = System.nanoTime()

            // 화면에 새 제목이 보일 때까지 100ms 마다 읽는다
            var shownStale = 0
            while (postCache.getAll(listOf(id)).single().title != "상추 나눔했어요") {
                shownStale++
                Thread.sleep(100)
            }
            val staleMillis = (System.nanoTime() - t0) / 1_000_000
            println("[실험⑤] $name · 옛 제목이 보인 시간 ${staleMillis}ms (읽기 ${shownStale}번, 글 요약 TTL 3초)")
            if (queue == CACHE_QUEUE) assertThat(staleMillis).isBetween(500, 1_900) else assertThat(staleMillis).isGreaterThan(2_500)
        }
    }

    private val regions = AtomicLong(System.nanoTime() % 1_000_000 * 1_000)

    /** 새 동네 하나와 글 n 개. 글은 outbox 를 거치지 않게 DB 에 바로 넣는다. */
    private fun seedRegion(posts: Int): Long {
        val region = regions.incrementAndGet()
        if (posts > 0) {
            jdbc.sql(
                """
                insert into post (author_id, region_id, content, created_at, title)
                select 1, :region, '본문 ' || g, now(), '글 ' || g from generate_series(1, :n) g
                """.trimIndent(),
            ).param("region", region).param("n", posts).update()
        }
        return region
    }

    /** outbox 에 쌓인 이벤트를 RabbitMQ 로 보내고, 캐시 리스너가 n 개를 처리할 때까지 기다린다. */
    private fun send(n: Int) {
        val before = cacheListener.handled.get()
        relay.relayOnce()
        await atMost WAIT until { cacheListener.handled.get() >= before + n }
    }

    private fun publish(queue: String, type: String, postId: Long, regionId: Long) {
        val body = jsonMapper.writeValueAsBytes(PostEventPayload(postId, regionId))
        rabbit.send(
            "", queue,
            MessageBuilder.withBody(body).setType(type).setContentType(MessageProperties.CONTENT_TYPE_JSON).build(),
        )
    }

    private companion object {
        val WAIT: Duration = Duration.ofSeconds(10)
    }
}
