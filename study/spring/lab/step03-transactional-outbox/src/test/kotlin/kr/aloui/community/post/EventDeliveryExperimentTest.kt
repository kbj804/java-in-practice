package kr.aloui.community.post

import kr.aloui.community.TestcontainersConfiguration
import kr.aloui.community.message.MessageBroker
import kr.aloui.community.outbox.OutboxEventRepository
import kr.aloui.community.outbox.OutboxRelay
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.data.domain.Limit
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * 실험 ②. 글 5개씩, 세 방법(가: 커밋 전 바로 보냄, 나: 커밋 후 보냄, 다: outbox)을 두 장애 상황에서 비교한다.
 * - 브로커 장애: 글을 쓰는 동안 브로커가 죽어 있다가, 다 쓴 뒤 살아난다. 그 뒤 릴레이가 한 번 돈다.
 * - 뒤 단계 실패: 메시지를 맡긴 뒤 같은 트랜잭션의 뒤 단계가 실패해 롤백된다.
 * 결과는 "[실험②]" 로 시작하는 줄로 출력한다.
 */
@SpringBootTest(properties = ["outbox.relay.enabled=false"]) // 릴레이는 테스트가 직접 돌린다
@Import(TestcontainersConfiguration::class)
class EventDeliveryExperimentTest(
    @Autowired private val beforeCommit: BeforeCommitPostWriter,
    @Autowired private val afterCommit: AfterCommitPostWriter,
    @Autowired private val outbox: OutboxPostWriter,
    @Autowired private val relay: OutboxRelay,
    @Autowired private val outboxRepository: OutboxEventRepository,
    @Autowired private val postRepository: PostRepository,
    @Autowired private val broker: MessageBroker,
    @Autowired private val jsonMapper: JsonMapper,
) {
    private val writes = 5

    @BeforeEach
    fun resetBroker() {
        broker.down = false
        broker.latency = Duration.ZERO
        broker.received.clear()
    }

    @Test
    fun `가 - 커밋 전에 보내면 브로커 장애 때 글쓰기까지 실패하고, 롤백되면 유령 메시지가 남는다`() {
        val down = run(Way.BEFORE_COMMIT, Trouble.BROKER_DOWN)
        assertThat(down.accepted).isZero()
        assertThat(down.saved).isZero()

        val rollback = run(Way.BEFORE_COMMIT, Trouble.LATER_STEP_FAILS)
        assertThat(rollback.saved).isZero()
        assertThat(rollback.ghost).isEqualTo(writes)
    }

    @Test
    fun `나 - 커밋 후에 보내면 브로커 장애 동안 쓴 글의 메시지가 사라지고 살아나도 돌아오지 않는다`() {
        val down = run(Way.AFTER_COMMIT, Trouble.BROKER_DOWN)
        assertThat(down.saved).isEqualTo(writes)
        assertThat(down.lost).isEqualTo(writes)

        val rollback = run(Way.AFTER_COMMIT, Trouble.LATER_STEP_FAILS)
        assertThat(rollback.saved).isZero()
        assertThat(rollback.ghost).isZero()
    }

    @Test
    fun `다 - outbox 는 브로커가 살아난 뒤 릴레이가 모두 보내고, 롤백되면 메시지도 함께 사라진다`() {
        val down = run(Way.OUTBOX, Trouble.BROKER_DOWN)
        assertThat(down.saved).isEqualTo(writes)
        assertThat(down.lost).isZero()

        val rollback = run(Way.OUTBOX, Trouble.LATER_STEP_FAILS)
        assertThat(rollback.saved).isZero()
        assertThat(rollback.ghost).isZero()
    }

    @Test
    fun `릴레이 두 개가 동시에 돌아도 SKIP LOCKED 로 나눠 가져가 같은 메시지를 두 번 보내지 않는다`() {
        relay.relayOnce() // 앞 테스트가 남긴 행을 비운다
        broker.received.clear()
        val region = nextRegion.incrementAndGet().toLong()
        repeat(20) { outbox.write(1, region, "릴레이 경쟁 $it") }
        broker.latency = Duration.ofMillis(20) // 한 번에 5건 = 100ms 동안 행을 잠그고 있다

        val start = CountDownLatch(1)
        val sentBy = Executors.newFixedThreadPool(2).use { pool ->
            val futures = (1..2).map {
                pool.submit<Int> {
                    start.await()
                    var total = 0
                    while (true) {
                        val sent = relay.relayOnce(batchSize = 5)
                        if (sent == 0) break
                        total += sent
                    }
                    total
                }
            }
            start.countDown()
            futures.map { it.get() }
        }

        val ids = broker.received.map { it.eventId }
        println("[실험②] 릴레이 두 개: 각각 ${sentBy[0]}건 · ${sentBy[1]}건, 브로커가 받은 메시지 ${ids.size}건 (서로 다른 id ${ids.toSet().size}개)")
        assertThat(ids).hasSize(20).doesNotHaveDuplicates()
        assertThat(sentBy).allSatisfy { assertThat(it).isPositive() }
        assertThat(outboxRepository.countByPublishedAtIsNull()).isZero()
    }

    companion object {
        // JUnit 은 테스트 메서드마다 인스턴스를 새로 만든다. 시나리오끼리 글이 섞이지 않게 지역 번호를 클래스 단위로 센다.
        private val nextRegion = AtomicInteger(10_000)
    }

    private enum class Way(val label: String) {
        BEFORE_COMMIT("가 커밋 전 바로 보냄"),
        AFTER_COMMIT("나 커밋 후 보냄"),
        OUTBOX("다 outbox"),
    }

    private enum class Trouble(val label: String) {
        BROKER_DOWN("브로커 장애"),
        LATER_STEP_FAILS("뒤 단계 실패"),
    }

    /** accepted 요청 성공, saved 저장된 글, sent 브로커가 받은 메시지, lost 메시지 없는 글, ghost 글 없는 메시지 */
    private data class Outcome(val accepted: Int, val saved: Int, val sent: Int, val lost: Int, val ghost: Int)

    private fun run(way: Way, trouble: Trouble): Outcome {
        val region = nextRegion.incrementAndGet().toLong()
        broker.down = trouble == Trouble.BROKER_DOWN
        val accepted = (1..writes).count { i ->
            runCatching { write(way, region, "글 $i", failAtEnd = trouble == Trouble.LATER_STEP_FAILS) }.isSuccess
        }
        broker.down = false
        relay.relayOnce() // outbox 가 아니면 할 일이 없다

        val savedIds = postRepository.findByRegionIdOrderByCreatedAtDesc(region, Limit.of(100)).map { it.id!! }.toSet()
        val sentIds = broker.received
            .map { jsonMapper.readValue(it.payload, PostCreatedPayload::class.java) }
            .filter { it.regionId == region }
            .map { it.postId }
        val outcome = Outcome(
            accepted = accepted,
            saved = savedIds.size,
            sent = sentIds.size,
            lost = savedIds.count { it !in sentIds },
            ghost = sentIds.count { !postRepository.existsById(it) },
        )
        println(
            "[실험②] ${way.label} · ${trouble.label}: 요청 성공 ${outcome.accepted}/$writes, 저장된 글 ${outcome.saved}, " +
                "보낸 메시지 ${outcome.sent}, 유실 ${outcome.lost}, 유령 ${outcome.ghost}",
        )
        return outcome
    }

    private fun write(way: Way, region: Long, content: String, failAtEnd: Boolean) = when (way) {
        Way.BEFORE_COMMIT -> beforeCommit.write(1, region, content, failAtEnd)
        Way.AFTER_COMMIT -> afterCommit.write(1, region, content, failAtEnd)
        Way.OUTBOX -> outbox.write(1, region, content, failAtEnd)
    }
}
